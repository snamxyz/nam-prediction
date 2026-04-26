"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRangeMarketSocket, useRangePositions, useActiveRangeMarkets } from "@/hooks/useRangeMarkets";
import type { RangeMarket, RangeOutcome, RangePosition } from "@nam-prediction/shared";
import {
  TRADING_DOMAIN,
  RANGE_TRADE_INTENT_TYPES,
  RANGE_TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";
import { fetchApi, authedPostApi } from "@/lib/api";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { createWalletClient, custom, parseUnits } from "viem";
import { base } from "viem/chains";
import { toast } from "sonner";
import { useVaultBalance } from "@/hooks/useVaultBalance";

const RANGE_COLORS = [
  "#6c7aff",
  "#01d243",
  "#f0a832",
  "#f0324c",
  "#a78bfa",
  "#38bdf8",
];

function useCountdown(iso?: string) {
  const [value, setValue] = useState({ h: "00", m: "00", s: "00", ended: false });
  useEffect(() => {
    if (!iso) return;
    const tick = () => {
      const d = (new Date(iso).getTime() - Date.now()) / 1000;
      if (d <= 0) return setValue({ h: "00", m: "00", s: "00", ended: true });
      const h = Math.floor((d % 86400) / 3600);
      const m = Math.floor((d % 3600) / 60);
      const s = Math.floor(d % 60);
      setValue({
        h: String(h).padStart(2, "0"),
        m: String(m).padStart(2, "0"),
        s: String(s).padStart(2, "0"),
        ended: false,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return value;
}

interface RangeCardSelectableProps {
  range: RangeOutcome;
  price: number;
  color: string;
  selected: boolean;
  isWinner?: boolean;
  isLoser?: boolean;
  userBalance: string;
  onClick: () => void;
}

function RangeCardSelectable({
  range,
  price,
  color,
  selected,
  isWinner,
  isLoser,
  userBalance,
  onClick,
}: RangeCardSelectableProps) {
  const pct = (price * 100).toFixed(1);
  const hasBal = parseFloat(userBalance) > 0;

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "16px 18px",
        borderRadius: 10,
        border: selected
          ? `2px solid ${color}`
          : isWinner
          ? `2px solid ${color}`
          : "2px solid rgba(255,255,255,0.06)",
        background: selected
          ? `${color}15`
          : isWinner
          ? `${color}10`
          : isLoser
          ? "rgba(255,255,255,0.02)"
          : "#0d0e14",
        cursor: isLoser ? "default" : "pointer",
        textAlign: "left",
        transition: "all 0.15s",
        opacity: isLoser ? 0.45 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: isLoser ? "#4c4e68" : "#e4e5eb" }}>
            {range.label}
          </span>
          {isWinner && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color,
                background: `${color}20`,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              WINNER
            </span>
          )}
        </div>
        <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,0.05)" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, parseFloat(pct))}%`,
              background: color,
              borderRadius: 3,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        {hasBal && (
          <p style={{ fontSize: 10, color: "#4c4e68", marginTop: 6 }}>
            You hold: {parseFloat(userBalance).toFixed(2)} tokens
          </p>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: isLoser ? "#4c4e68" : color }}>
          {pct}¢
        </span>
        <p style={{ fontSize: 10, color: "#4c4e68", marginTop: 2 }}>probability</p>
      </div>
    </button>
  );
}

const QUICK_BUY = [1, 5, 10, 100];
const SELL_PERCENTS = [25, 50, 100] as const;
const SLIPPAGE_PRESETS = [0.5, 1, 2, 5];

interface NonceResponse {
  wallet: string;
  nonce: string;
  suggestedDeadline: string;
}

interface TradeResult {
  txHash: string;
  sharesOut?: string;
  sharesOutFloat?: number;
  sharesSold?: string;
  rangePrices?: number[];
}

interface TradePanelRangeProps {
  market: RangeMarket;
  selectedRangeIndex: number | null;
  prices: number[];
  positions: RangePosition[];
  onSuccess: () => void;
  onPricesUpdate: (prices: number[]) => void;
}

function TradePanelRange({
  market,
  selectedRangeIndex,
  prices,
  positions,
  onSuccess,
  onPricesUpdate,
}: TradePanelRangeProps) {
  const { address, isConnected } = useAccount();
  const { getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const { usdcBalance } = useVaultBalance();

  const [mode, setMode] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotedTokens, setQuotedTokens] = useState<number | null>(null);
  const [quotedSharesRaw, setQuotedSharesRaw] = useState<string | null>(null);
  const [quotedAmount, setQuotedAmount] = useState("");
  const [quotedRangeIndex, setQuotedRangeIndex] = useState<number | null>(null);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userAddress = user?.wallet?.address?.toLowerCase() ?? null;
  const isAuthenticated = !!userAddress;

  const ranges = market.ranges as RangeOutcome[];
  const selectedRange = selectedRangeIndex != null ? ranges[selectedRangeIndex] : null;
  const selectedPrice = selectedRangeIndex != null ? prices[selectedRangeIndex] ?? 0 : 0;
  const selectedPosition = positions.find((p) => p.rangeIndex === selectedRangeIndex);
  const ownedBalanceStr = selectedPosition?.balance ?? "0";
  const ownedBalance = parseFloat(ownedBalanceStr) || 0;

  const num = parseFloat(amount) || 0;
  const fallbackEstimate = mode === "BUY" && selectedPrice > 0 && num > 0 ? num / selectedPrice : 0;
  const hasCurrentBuyQuote =
    mode !== "BUY" ||
    (quotedTokens !== null &&
      quotedSharesRaw !== null &&
      quotedAmount === amount &&
      quotedRangeIndex === selectedRangeIndex);
  const estimatedTokens = (hasCurrentBuyQuote && quotedTokens !== null && quotedTokens > 0) ? quotedTokens : fallbackEstimate;

  useEffect(() => {
    if (mode !== "BUY" || selectedRangeIndex == null || num <= 0 || !market.rangeCpmmAddress) {
      setQuotedTokens(null);
      setQuotedSharesRaw(null);
      setQuotedAmount("");
      setQuotedRangeIndex(null);
      return;
    }
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    quoteTimerRef.current = setTimeout(async () => {
      try {
        const result = await fetchApi<{ rangeIndex: number; usdcAmount: number; sharesOut: string; sharesOutFloat: number }>(
          `/range-markets/${market.id}/quote?rangeIndex=${selectedRangeIndex}&usdcAmount=${num}`
        );
        setQuotedTokens(result.sharesOutFloat);
        setQuotedSharesRaw(result.sharesOut);
        setQuotedAmount(amount);
        setQuotedRangeIndex(selectedRangeIndex);
      } catch {
        setQuotedTokens(null);
        setQuotedSharesRaw(null);
        setQuotedAmount("");
        setQuotedRangeIndex(null);
      }
    }, 400);
    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    };
  }, [mode, selectedRangeIndex, num, amount, market.id, market.rangeCpmmAddress]);

  const clearQuote = () => {
    setQuotedTokens(null);
    setQuotedSharesRaw(null);
    setQuotedAmount("");
    setQuotedRangeIndex(null);
  };

  const setSellPercent = (pct: number) => {
    if (ownedBalance <= 0) return;
    clearQuote();
    if (pct >= 100) {
      setAmount(ownedBalanceStr);
      return;
    }
    setAmount((ownedBalance * (pct / 100)).toFixed(6));
  };

  const handleTrade = async () => {
    if (!address || !amount || !wallets.length || selectedRangeIndex == null) return;
    if (!market.rangeCpmmAddress) return;

    setIsLoading(true);
    setError(null);
    const toastId = `range-trade-${Date.now()}`;

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      const amountRaw =
        mode === "BUY" ? parseUnits(amount, 6) : parseUnits(amount, 18);
      const slippageBps = BigInt(Math.round(slippagePct * 100));
      const minOutputRaw =
        mode === "BUY" && quotedSharesRaw && quotedAmount === amount && quotedRangeIndex === selectedRangeIndex
          ? (parseUnits(quotedSharesRaw, 18) * (BigInt(10_000) - slippageBps)) / BigInt(10_000)
          : BigInt(0);

      toast.loading("Preparing trade…", { id: toastId });
      const { nonce, suggestedDeadline } = await fetchApi<NonceResponse>(
        `/trading/nonce/${address}`
      );
      const deadline = BigInt(suggestedDeadline);

      toast.loading("Sign the trade in your wallet…", { id: toastId });
      const signature = await walletClient.signTypedData({
        account: address,
        domain: { ...TRADING_DOMAIN, chainId: base.id },
        types: RANGE_TRADE_INTENT_TYPES,
        primaryType: RANGE_TRADE_INTENT_PRIMARY_TYPE,
        message: {
          trader: address,
          marketId: BigInt(market.onChainMarketId ?? market.id),
          cpmmAddress: market.rangeCpmmAddress as `0x${string}`,
          rangeIndex: BigInt(selectedRangeIndex),
          isBuy: mode === "BUY",
          amount: amountRaw,
          minOutput: minOutputRaw,
          nonce: BigInt(nonce),
          deadline,
        },
      });

      toast.loading("Submitting trade…", { id: toastId });
      const endpoint =
        mode === "BUY"
          ? `/range-markets/${market.id}/buy`
          : `/range-markets/${market.id}/sell`;

      const result = await authedPostApi<TradeResult>(
        endpoint,
        {
          rangeIndex: selectedRangeIndex,
          ...(mode === "BUY"
            ? { usdcAmount: parseFloat(amount) }
            : { shares: parseFloat(amount) }),
          userAddress: address,
          minOutput: minOutputRaw.toString(),
          signature,
          nonce,
          deadline: deadline.toString(),
        },
        token
      );

      if (result?.rangePrices && result.rangePrices.length > 0) {
        onPricesUpdate(result.rangePrices);
      }

      const label = selectedRange?.label ?? `Range ${selectedRangeIndex}`;
      const successMsg =
        mode === "BUY"
          ? `Bought ${label} · $${num.toFixed(2)}`
          : `Sold ${label} · ${num} tokens`;
      toast.success(successMsg, { id: toastId });

      setAmount("");
      clearQuote();
      onSuccess();
    } catch (err: unknown) {
      console.error("Range trade failed:", err);
      const msg =
        (err as { shortMessage?: string; message?: string }).shortMessage ||
        (err as Error).message ||
        "Trade failed";
      const isRejection = /user (rejected|denied)|rejected the request/i.test(msg);
      const display = isRejection ? "Signature rejected" : msg;
      setError(display);
      toast.error(display, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!userAddress) return;
    setIsLoading(true);
    setError(null);
    const toastId = `range-redeem-${Date.now()}`;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      toast.loading("Redeeming…", { id: toastId });
      await authedPostApi(
        `/range-markets/${market.id}/redeem`,
        { userAddress },
        token
      );
      toast.success("Winnings redeemed!", { id: toastId });
      onSuccess();
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "Redeem failed";
      setError(msg);
      toast.error(msg, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  if (!market.rangeCpmmAddress && !market.resolved) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#e4e5eb", marginBottom: 8 }}>
          Trading Coming Soon
        </p>
        <p style={{ fontSize: 12, color: "#4c4e68", lineHeight: 1.6 }}>
          This market is not yet deployed on-chain.
          <br />
          Trading will be available shortly.
        </p>
      </div>
    );
  }

  if (market.resolved) {
    const winIdx = market.winningRangeIndex;
    const winRange = winIdx != null ? ranges[winIdx] : null;
    const winPosition = winIdx != null ? positions.find((p) => p.rangeIndex === winIdx) : null;
    const canRedeem = winPosition && parseFloat(winPosition.balance) > 0;

    return (
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e4e5eb" }}>Market Resolved</h3>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          {winRange && (
            <p style={{ fontSize: 13, color: "#01d243", marginBottom: 14 }}>
              Winner: <strong>{winRange.label}</strong>
            </p>
          )}
          {canRedeem ? (
            <>
              <p style={{ fontSize: 12, color: "#8081a0", marginBottom: 14 }}>
                You hold {parseFloat(winPosition!.balance).toFixed(4)} winning tokens.
                Redeem for {parseFloat(winPosition!.balance).toFixed(4)} USDC.
              </p>
              <button
                onClick={handleRedeem}
                disabled={isLoading}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 10,
                  background: "#01d243",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                {isLoading ? "Redeeming…" : "Redeem Winnings"}
              </button>
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#4c4e68" }}>
              {positions.length === 0
                ? "You had no positions in this market."
                : "Your positions were on losing ranges — no payout."}
            </p>
          )}
          {error && (
            <p style={{ fontSize: 11, color: "#f0324c", marginTop: 10 }}>{error}</p>
          )}
        </div>
      </div>
    );
  }

  const canTrade =
    isConnected &&
    num > 0 &&
    !isLoading &&
    wallets.length > 0 &&
    selectedRangeIndex != null &&
    hasCurrentBuyQuote;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e4e5eb" }}>Trade</h3>
          {isAuthenticated && (
            <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>
              Balance:{" "}
              <span style={{ color: "#01d243" }}>
                ${parseFloat(usdcBalance).toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 20px 20px" }}>
        {/* BUY / SELL toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
          {(["BUY", "SELL"] as const).map((m) => {
            const active = mode === m;
            const mc = m === "BUY" ? "#01d243" : "#f0324c";
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(""); setError(null); clearQuote(); }}
                style={{
                  padding: "8px 0",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1px solid ${active ? mc + "4d" : "rgba(255,255,255,0.04)"}`,
                  background: active ? mc + "18" : "#111320",
                  color: active ? mc : "#4c4e68",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Selected range */}
        <div style={{ marginBottom: 18, padding: "10px 14px", borderRadius: 8, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
          {selectedRangeIndex != null && selectedRange ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: RANGE_COLORS[selectedRangeIndex % RANGE_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e4e5eb" }}>{selectedRange.label}</span>
              </div>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: RANGE_COLORS[selectedRangeIndex % RANGE_COLORS.length] }}>
                {(selectedPrice * 100).toFixed(1)}¢
              </span>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#4c4e68", textAlign: "center" }}>← Select a range from the left</p>
          )}
        </div>

        {/* Amount label + owned info */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <p style={{ fontSize: 11, color: "#4c4e68" }}>{mode === "BUY" ? "Amount (USDC)" : "Tokens to Sell"}</p>
          {mode === "SELL" && isAuthenticated && (
            <p style={{ fontSize: 11, color: "#4c4e68" }}>
              Owned: <span style={{ color: ownedBalance > 0 ? "#6c7aff" : "#4c4e68", fontWeight: 600 }}>{ownedBalance > 0 ? ownedBalance.toFixed(4) : "0"}</span>
            </p>
          )}
        </div>

        {/* Amount input */}
        <div style={{ position: "relative", marginBottom: 10 }}>
          {mode === "BUY" && (
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#4c4e68" }}>$</span>
          )}
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              clearQuote();
            }}
            className="mono"
            style={{
              width: "100%",
              borderRadius: 8,
              paddingRight: 14,
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: mode === "BUY" ? 28 : 14,
              fontSize: 13,
              textAlign: "right",
              outline: "none",
              background: "#111320",
              color: "#e4e5eb",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          />
        </div>

        {/* Quick amounts */}
        {mode === "BUY" ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {QUICK_BUY.map((q) => (
              <button key={q} onClick={() => {
                setAmount((s) => String((parseFloat(s) || 0) + q));
                clearQuote();
              }}
                style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, background: "#111320", color: "#4c4e68", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
                +${q}
              </button>
            ))}
            <button onClick={() => {
              setAmount(usdcBalance);
              clearQuote();
            }}
              style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, background: "#111320", color: "#4c4e68", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
              Max
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedBalance <= 0;
              return (
                <button key={p} onClick={() => setSellPercent(p)} disabled={disabled}
                  style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, background: "#111320", color: disabled ? "rgba(76,78,104,0.50)" : "#4c4e68", cursor: disabled ? "not-allowed" : "pointer", border: "1px solid rgba(255,255,255,0.04)" }}>
                  {p === 100 ? "MAX" : `${p}%`}
                </button>
              );
            })}
          </div>
        )}

        {/* Slippage */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <p style={{ fontSize: 11, color: "#4c4e68" }}>Max slippage</p>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {SLIPPAGE_PRESETS.map((s) => {
              const active = slippagePct === s;
              return (
                <button key={s} onClick={() => setSlippagePct(s)}
                  style={{ padding: "4px 8px", borderRadius: 4, fontSize: 10, border: `1px solid ${active ? "rgba(1,210,67,0.30)" : "rgba(255,255,255,0.04)"}`, background: active ? "rgba(1,210,67,0.12)" : "#111320", color: active ? "#01d243" : "#4c4e68", cursor: "pointer" }}>
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div style={{ borderRadius: 10, padding: 14, marginBottom: 18, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
            <span style={{ color: "#4c4e68" }}>Probability</span>
            <span className="mono" style={{ color: "#e4e5eb" }}>{(selectedPrice * 100).toFixed(1)}¢</span>
          </div>
          {mode === "BUY" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: "#4c4e68" }}>
                  Est. tokens
                  {quotedTokens !== null && <span style={{ fontSize: 9, color: "#4c4e68", marginLeft: 4 }}>(exact)</span>}
                </span>
                <span className="mono" style={{ color: "#e4e5eb" }}>{num > 0 ? estimatedTokens.toFixed(4) : "—"}</span>
              </div>
              {num > 0 && quotedTokens !== null && fallbackEstimate > 0 &&
                (fallbackEstimate - quotedTokens) / fallbackEstimate > 0.05 && (
                <div style={{ fontSize: 10, color: "#f0a832", marginBottom: 6 }}>
                  ⚠ High price impact ({(((fallbackEstimate - quotedTokens) / fallbackEstimate) * 100).toFixed(1)}%)
                </div>
              )}
              <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#4c4e68" }}>Win payout</span>
                <span className="mono" style={{ color: num > 0 ? "#01d243" : "#4c4e68", fontWeight: num > 0 ? 600 : 400 }}>
                  {num > 0 ? `$${estimatedTokens.toFixed(2)}` : "—"}
                </span>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: "#4c4e68" }}>USDC received (est.)</span>
              <span className="mono" style={{ color: num > 0 ? "#01d243" : "#4c4e68", fontWeight: num > 0 ? 600 : 400 }}>
                {num > 0 && selectedPrice > 0 ? `$${(num * selectedPrice).toFixed(4)}` : "—"}
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p style={{ fontSize: 11, marginBottom: 10, padding: "8px 12px", borderRadius: 8, color: "#f0324c", background: "rgba(240,50,76,0.08)", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            {error}
          </p>
        )}

        {/* Trade button */}
        {!isAuthenticated ? (
          <button style={{ width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "#01d243", color: "#000", cursor: "pointer", border: "none" }}>
            Connect to Trade
          </button>
        ) : (
          <button onClick={handleTrade} disabled={!canTrade}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none", transition: "all 0.12s",
              ...(canTrade
                ? { background: mode === "BUY" ? "#01d243" : "#f0324c", color: mode === "BUY" ? "#000" : "#fff", cursor: "pointer" }
                : { background: "#111320", color: "#4c4e68", cursor: "not-allowed" }),
            }}
          >
            {isLoading
              ? "Processing…"
              : num > 0 && selectedRange
              ? `${mode === "BUY" ? "Buy" : "Sell"} ${selectedRange.label}${mode === "BUY" ? ` · $${num.toFixed(2)}` : ` · ${num} tokens`}`
              : selectedRangeIndex == null
              ? "Select a range"
              : "Enter an amount"}
          </button>
        )}

        <p style={{ textAlign: "center", fontSize: 9, marginTop: 10, color: "rgba(76,78,104,0.50)" }}>
          Each trade requires a wallet signature. By trading, you agree to the Terms of Use.
        </p>

        {/* Current position */}
        {isAuthenticated && selectedRangeIndex != null && ownedBalance > 0.000001 && (
          <div style={{ marginTop: 14, borderRadius: 10, padding: 14, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "#4c4e68" }}>Your Position</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: `${RANGE_COLORS[selectedRangeIndex % RANGE_COLORS.length]}20`, color: RANGE_COLORS[selectedRangeIndex % RANGE_COLORS.length] }}>
                  {selectedRange?.label}
                </span>
                <span className="mono" style={{ color: "#e4e5eb" }}>{ownedBalance.toFixed(4)} tokens</span>
              </div>
              <span className="mono" style={{ color: "#4c4e68" }}>@{((selectedPosition?.avgEntryPrice ?? selectedPrice) * 100).toFixed(1)}¢ avg</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface RangeMarketDetailProps {
  marketType: "receipts" | "nam-distribution";
  title: string;
  description: string;
}

export function RangeMarketDetail({ marketType, title, description }: RangeMarketDetailProps) {
  const { data: allMarkets, isLoading, refetch } = useActiveRangeMarkets();
  const market = allMarkets?.find((m) => m.marketType === marketType) ?? null;
  const { livePrices, setLivePrices } = useRangeMarketSocket(market?.id);
  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const userAddress = user?.wallet?.address?.toLowerCase() ?? null;
  const { data: positions = [], refetch: refetchPositions } = useRangePositions(market?.id, userAddress ?? undefined);
  const [selectedRange, setSelectedRange] = useState<number | null>(null);
  const countdown = useCountdown(market?.endTime);
  const refreshAfterTrade = () => {
    void refetch();
    void refetchPositions();
    if (market?.id != null) {
      void queryClient.invalidateQueries({ queryKey: ["range-markets-active"] });
      void queryClient.refetchQueries({ queryKey: ["range-markets-active"] });
      void queryClient.invalidateQueries({ queryKey: ["range-market", market.id] });
      void queryClient.invalidateQueries({ queryKey: ["range-markets"] });
      if (userAddress) {
        void queryClient.invalidateQueries({ queryKey: ["range-positions", market.id, userAddress] });
      }
    }
  };

  const prices: number[] = livePrices ?? (market?.rangePrices as number[]) ?? [];
  const ranges: RangeOutcome[] = (market?.ranges as RangeOutcome[]) ?? [];
  const total = prices.reduce((a, b) => a + b, 0);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="card" style={{ height: 200, marginBottom: 16 }} />
        <div className="card" style={{ height: 400 }} />
      </div>
    );
  }

  if (!market) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4c4e68", marginBottom: 16, textDecoration: "none" }}>
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="card" style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "#4c4e68", marginBottom: 8 }}>No active {title} market found.</p>
          <p style={{ fontSize: 12, color: "#2d2e45" }}>Markets are created daily at 00:00 ET.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4c4e68", marginBottom: 16, transition: "color 0.12s", textDecoration: "none" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#e4e5eb")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#4c4e68")}>
        <ArrowLeft size={14} /> Back to Markets
      </Link>

      {/* Header card */}
      <div className="card" style={{ padding: "24px 28px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                color: marketType === "receipts" ? "#6c7aff" : "#f0a832",
                background: marketType === "receipts" ? "rgba(108,122,255,0.12)" : "rgba(240,168,50,0.12)",
                padding: "3px 8px", borderRadius: 4,
              }}>
                {marketType === "receipts" ? "Receipts" : "NAM Distribution"}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: market.resolved ? "#01d243" : "#8081a0",
                background: market.resolved ? "rgba(1,210,67,0.08)" : "rgba(255,255,255,0.04)",
                padding: "3px 8px", borderRadius: 4,
              }}>
                {market.resolved ? "RESOLVED" : "ACTIVE"}
              </span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e4e5eb", marginBottom: 8 }}>{market.question}</h1>
            <p style={{ fontSize: 12, color: "#4c4e68" }}>{description}</p>
          </div>

          {!market.resolved && (
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {[{ v: countdown.h, l: "H" }, { v: countdown.m, l: "M" }, { v: countdown.s, l: "S" }].map(({ v, l }) => (
                  <div key={l} style={{ textAlign: "center" }}>
                    <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "#e4e5eb", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "4px 8px", minWidth: 40 }}>{v}</div>
                    <div style={{ fontSize: 9, color: "#4c4e68", marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10, color: "#4c4e68", marginTop: 6 }}>Resolves {market.date}</p>
            </div>
          )}
          {market.resolved && market.winningRangeIndex != null && (
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: "#4c4e68", marginBottom: 4 }}>Winner</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: RANGE_COLORS[market.winningRangeIndex % RANGE_COLORS.length] }}>
                {ranges[market.winningRangeIndex]?.label}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
        {/* Range selection */}
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e4e5eb", marginBottom: 14 }}>
            Outcomes
            <span style={{ fontSize: 11, color: "#4c4e68", marginLeft: 8, fontWeight: 400 }}>probabilities sum to 100%</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ranges.map((range, i) => {
              const displayPrice = total > 0 ? (prices[i] ?? 0) / total : 1 / ranges.length;
              const isWinner = market.resolved && market.winningRangeIndex === i;
              const isLoser = market.resolved && market.winningRangeIndex !== i;
              const pos = positions.find((p) => p.rangeIndex === i);
              return (
                <RangeCardSelectable
                  key={range.index}
                  range={range}
                  price={displayPrice}
                  color={RANGE_COLORS[i % RANGE_COLORS.length]}
                  selected={selectedRange === i}
                  isWinner={isWinner || undefined}
                  isLoser={isLoser || undefined}
                  userBalance={pos?.balance ?? "0"}
                  onClick={() => { if (!isLoser) setSelectedRange(i === selectedRange ? null : i); }}
                />
              );
            })}
          </div>

          {/* Positions summary */}
          {positions.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <p style={{ fontSize: 11, color: "#4c4e68", marginBottom: 10 }}>Your Positions</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {positions.filter((p) => parseFloat(p.balance) > 0).map((p) => {
                  const range = ranges[p.rangeIndex];
                  const color = RANGE_COLORS[p.rangeIndex % RANGE_COLORS.length];
                  return (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize: 12, color, fontWeight: 600 }}>{range?.label ?? `Range ${p.rangeIndex}`}</span>
                      <div style={{ textAlign: "right" }}>
                        <span className="mono" style={{ fontSize: 12, color: "#e4e5eb" }}>{parseFloat(p.balance).toFixed(2)} tokens</span>
                        <span style={{ fontSize: 10, color: "#4c4e68", marginLeft: 8 }}>@{(p.avgEntryPrice * 100).toFixed(1)}¢ avg</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Trade panel */}
        <TradePanelRange
          market={market}
          selectedRangeIndex={selectedRange}
          prices={prices}
          positions={positions}
          onSuccess={refreshAfterTrade}
          onPricesUpdate={setLivePrices}
        />
      </div>
    </div>
  );
}
