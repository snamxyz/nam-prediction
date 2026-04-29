"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRangeMarketSocket, useRangePositions, useActiveRangeMarkets, useRangeTrades } from "@/hooks/useRangeMarkets";
import type { RangeMarket, RangeOutcome, RangePosition } from "@nam-prediction/shared";
import {
  TRADING_DOMAIN,
  RANGE_TRADE_INTENT_TYPES,
  RANGE_TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";
import { fetchApi, authedPostApi } from "@/lib/api";
import { RangeProbabilityChart } from "@/components/RangeProbabilityChart";
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

const RANGE_TEXT_CLASSES = [
  "text-[#6c7aff]",
  "text-[#01d243]",
  "text-[#f0a832]",
  "text-[#f0324c]",
  "text-[#a78bfa]",
  "text-[#38bdf8]",
];

const RANGE_BG_CLASSES = [
  "bg-[#6c7aff]/15",
  "bg-[#01d243]/15",
  "bg-[#f0a832]/15",
  "bg-[#f0324c]/15",
  "bg-[#a78bfa]/15",
  "bg-[#38bdf8]/15",
];

const RANGE_BORDER_CLASSES = [
  "border-[#6c7aff]",
  "border-[#01d243]",
  "border-[#f0a832]",
  "border-[#f0324c]",
  "border-[#a78bfa]",
  "border-[#38bdf8]",
];

function getRangeClassIndex(color: string) {
  const index = RANGE_COLORS.indexOf(color);
  return index >= 0 ? index : 0;
}

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
  const colorIndex = getRangeClassIndex(color);
  const rangeTextClass = RANGE_TEXT_CLASSES[colorIndex];
  const rangeBgClass = RANGE_BG_CLASSES[colorIndex];
  const rangeBorderClass = RANGE_BORDER_CLASSES[colorIndex];
  const barPct = Math.min(100, parseFloat(pct));

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-[10px] border-2 px-[18px] py-4 text-left transition-all duration-150 ${
        isLoser ? "cursor-default opacity-45" : "cursor-pointer"
      } ${
        selected || isWinner
          ? `${rangeBgClass} ${rangeBorderClass}`
          : isLoser
            ? "border-white/[0.06] bg-white/[0.02]"
            : "border-white/[0.06] bg-[var(--surface)]"
      }`}
    >
      <div className="flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 10 10" aria-hidden="true">
            <circle cx="5" cy="5" r="5" fill={color} />
          </svg>
          <span className={`text-sm font-semibold ${isLoser ? "text-[var(--muted)]" : "text-[var(--foreground)]"}`}>
            {range.label}
          </span>
          {isWinner && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${rangeBgClass} ${rangeTextClass}`}>
              WINNER
            </span>
          )}
        </div>
        <svg
          className="block h-[3px] w-full rounded-full bg-white/[0.05]"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect width={barPct} height="1" fill={color} />
        </svg>
        {hasBal && (
          <p className="mt-1.5 text-[10px] text-[var(--muted)]">
            You hold: {parseFloat(userBalance).toFixed(2)} tokens
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <span className={`mono text-[22px] font-bold ${isLoser ? "text-[var(--muted)]" : rangeTextClass}`}>
          {pct}¢
        </span>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">probability</p>
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
  const poolLiquidity = parseFloat(market.totalLiquidity || "0") || 0;
  const priceImpactPct =
    mode === "BUY" && num > 0 && quotedTokens !== null && fallbackEstimate > 0
      ? Math.max(0, ((fallbackEstimate - quotedTokens) / fallbackEstimate) * 100)
      : 0;
  const winPayout = mode === "BUY" && num > 0 ? estimatedTokens : 0;
  const netIfWins = winPayout - num;

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
      <div className="card p-6 text-center">
        <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">
          Trading Coming Soon
        </p>
        <p className="text-xs leading-[1.6] text-[var(--muted)]">
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
      <div className="card overflow-hidden">
        <div className="border-b border-white/[0.04] px-5 py-4">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Market Resolved</h3>
        </div>
        <div className="px-5 pb-5 pt-4">
          {winRange && (
            <p className="mb-3.5 text-[13px] text-yes">
              Winner: <strong>{winRange.label}</strong>
            </p>
          )}
          {canRedeem ? (
            <>
              <p className="mb-3.5 text-xs text-[#8081a0]">
                You hold {parseFloat(winPosition!.balance).toFixed(4)} winning tokens.
                Redeem for {parseFloat(winPosition!.balance).toFixed(4)} USDC.
              </p>
              <button
                onClick={handleRedeem}
                disabled={isLoading}
                className={`w-full rounded-[10px] border-0 bg-yes py-3 text-[13px] font-bold text-black ${
                  isLoading ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`}
              >
                {isLoading ? "Redeeming…" : "Redeem Winnings"}
              </button>
            </>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {positions.length === 0
                ? "You had no positions in this market."
                : "Your positions were on losing ranges — no payout."}
            </p>
          )}
          {error && (
            <p className="mt-2.5 text-[11px] text-no">{error}</p>
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
  const selectedColorIndex =
    selectedRangeIndex != null ? selectedRangeIndex % RANGE_COLORS.length : 0;
  const selectedTextClass = RANGE_TEXT_CLASSES[selectedColorIndex];
  const selectedBgClass = RANGE_BG_CLASSES[selectedColorIndex];

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/[0.04] px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Trade</h3>
          {isAuthenticated && (
            <span className="mono text-[11px] text-[var(--muted)]">
              Balance:{" "}
              <span className="text-yes">
                ${parseFloat(usdcBalance).toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        {/* BUY / SELL toggle */}
        <div className="mb-3.5 grid grid-cols-2 gap-1.5">
          {(["BUY", "SELL"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(""); setError(null); clearQuote(); }}
                className={`cursor-pointer rounded-lg border py-2 text-[11px] font-bold transition-all duration-150 ${
                  active
                    ? m === "BUY"
                      ? "border-yes/30 bg-yes/10 text-yes"
                      : "border-no/30 bg-no/10 text-no"
                    : "border-white/[0.04] bg-[var(--surface-hover)] text-[var(--muted)]"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Selected range */}
        <div className="mb-[18px] rounded-lg border border-white/[0.04] bg-[var(--surface-hover)] px-3.5 py-2.5">
          {selectedRangeIndex != null && selectedRange ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
                  <circle cx="4" cy="4" r="4" fill={RANGE_COLORS[selectedColorIndex]} />
                </svg>
                <span className="text-[13px] font-semibold text-[var(--foreground)]">{selectedRange.label}</span>
              </div>
              <span className={`mono text-[13px] font-bold ${selectedTextClass}`}>
                {(selectedPrice * 100).toFixed(1)}¢
              </span>
            </div>
          ) : (
            <p className="text-center text-xs text-[var(--muted)]">← Select a range from the left</p>
          )}
        </div>

        {/* Amount label + owned info */}
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] text-[var(--muted)]">{mode === "BUY" ? "Amount (USDC)" : "Tokens to Sell"}</p>
          {mode === "SELL" && isAuthenticated && (
            <p className="text-[11px] text-[var(--muted)]">
              Owned: <span className={`font-semibold ${ownedBalance > 0 ? selectedTextClass : "text-[var(--muted)]"}`}>{ownedBalance > 0 ? ownedBalance.toFixed(4) : "0"}</span>
            </p>
          )}
        </div>

        {/* Amount input */}
        <div className="relative mb-2.5">
          {mode === "BUY" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--muted)]">$</span>
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
            className={`mono w-full rounded-lg border border-white/[0.04] bg-[var(--surface-hover)] py-2.5 pr-3.5 text-right text-[13px] text-[var(--foreground)] outline-none ${
              mode === "BUY" ? "pl-7" : "pl-3.5"
            }`}
          />
        </div>

        {/* Quick amounts */}
        {mode === "BUY" ? (
          <div className="mb-3.5 flex gap-1.5">
            {QUICK_BUY.map((q) => (
              <button key={q} onClick={() => {
                setAmount((s) => String((parseFloat(s) || 0) + q));
                clearQuote();
              }}
                className="flex-1 cursor-pointer rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)]">
                +${q}
              </button>
            ))}
            <button onClick={() => {
              setAmount(usdcBalance);
              clearQuote();
            }}
              className="flex-1 cursor-pointer rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)]">
              Max
            </button>
          </div>
        ) : (
          <div className="mb-3.5 flex gap-1.5">
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedBalance <= 0;
              return (
                <button key={p} onClick={() => setSellPercent(p)} disabled={disabled}
                  className={`flex-1 rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] ${
                    disabled
                      ? "cursor-not-allowed text-[var(--muted)]/50"
                      : "cursor-pointer text-[var(--muted)]"
                  }`}>
                  {p === 100 ? "MAX" : `${p}%`}
                </button>
              );
            })}
          </div>
        )}

        {/* Slippage */}
        <div className="mb-[18px] flex items-center justify-between">
          <p className="text-[11px] text-[var(--muted)]">Max slippage</p>
          <div className="flex items-center gap-1">
            {SLIPPAGE_PRESETS.map((s) => {
              const active = slippagePct === s;
              return (
                <button key={s} onClick={() => setSlippagePct(s)}
                  className={`cursor-pointer rounded border px-2 py-1 text-[10px] ${
                    active
                      ? "border-yes/30 bg-yes/[0.12] text-yes"
                      : "border-white/[0.04] bg-[var(--surface-hover)] text-[var(--muted)]"
                  }`}>
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div className="mb-[18px] rounded-[10px] border border-white/[0.04] bg-[var(--surface-hover)] p-3.5">
          <div className="mb-2 flex justify-between text-[11px]">
            <span className="text-[var(--muted)]">Probability</span>
            <span className="mono text-[var(--foreground)]">{(selectedPrice * 100).toFixed(1)}¢</span>
          </div>
          {mode === "BUY" ? (
            <>
              <div className="mb-2 flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">
                  Est. tokens
                  {quotedTokens !== null && <span className="ml-1 text-[9px] text-[var(--muted)]">(exact)</span>}
                </span>
                <span className="mono text-[var(--foreground)]">{num > 0 ? estimatedTokens.toFixed(4) : "—"}</span>
              </div>
              {num > 0 && quotedTokens !== null && fallbackEstimate > 0 &&
                priceImpactPct > 5 && (
                <div className="mb-1.5 text-[10px] text-[#f0a832]">
                  High price impact ({priceImpactPct.toFixed(1)}%)
                </div>
              )}
              <div className="mb-2 flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Pool liquidity</span>
                <span className="mono text-[var(--foreground)]">
                  {poolLiquidity > 0 ? `$${poolLiquidity.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="my-2 h-px bg-[var(--border-subtle)]" />
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Win payout</span>
                <span className={`mono ${num > 0 ? "font-semibold text-yes" : "font-normal text-[var(--muted)]"}`}>
                  {num > 0 ? `$${winPayout.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="mt-2 flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Net if wins</span>
                <span className={`mono ${num > 0 ? "font-semibold text-[var(--foreground)]" : "font-normal text-[var(--muted)]"}`}>
                  {num > 0 ? `${netIfWins >= 0 ? "+" : "-"}$${Math.abs(netIfWins).toFixed(2)}` : "—"}
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-[11px]">
              <span className="text-[var(--muted)]">USDC received (est.)</span>
              <span className={`mono ${num > 0 ? "font-semibold text-yes" : "font-normal text-[var(--muted)]"}`}>
                {num > 0 && selectedPrice > 0 ? `$${(num * selectedPrice).toFixed(4)}` : "—"}
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="mb-2.5 flex items-center gap-1.5 rounded-lg bg-no/[0.08] px-3 py-2 text-[11px] text-no">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            {error}
          </p>
        )}

        {/* Trade button */}
        {!isAuthenticated ? (
          <button className="w-full cursor-pointer rounded-[10px] border-0 bg-yes py-3 text-[13px] font-bold text-black">
            Connect to Trade
          </button>
        ) : (
          <button onClick={handleTrade} disabled={!canTrade}
            className={`w-full rounded-[10px] border-0 py-3 text-[13px] font-bold transition-all duration-150 ${
              canTrade
                ? mode === "BUY"
                  ? "cursor-pointer bg-yes text-black"
                  : "cursor-pointer bg-no text-white"
                : "cursor-not-allowed bg-[var(--surface-hover)] text-[var(--muted)]"
            }`}
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

        <p className="mt-2.5 text-center text-[9px] text-[var(--muted)]/50">
          Each trade requires a wallet signature. By trading, you agree to the Terms of Use.
        </p>

        {/* Current position */}
        {isAuthenticated && selectedRangeIndex != null && ownedBalance > 0.000001 && (
          <div className="mt-3.5 rounded-[10px] border border-white/[0.04] bg-[var(--surface-hover)] p-3.5">
            <p className="mb-2 text-[11px] font-semibold text-[var(--muted)]">Your Position</p>
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${selectedBgClass} ${selectedTextClass}`}>
                  {selectedRange?.label}
                </span>
                <span className="mono text-[var(--foreground)]">{ownedBalance.toFixed(4)} tokens</span>
              </div>
              <span className="mono text-[var(--muted)]">@{((selectedPosition?.avgEntryPrice ?? selectedPrice) * 100).toFixed(1)}¢ avg</span>
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
  const { data: trades = [] } = useRangeTrades(market?.id);
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
      void queryClient.invalidateQueries({ queryKey: ["range-trades", market.id] });
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
      <div className="mx-auto max-w-[1200px]">
        <div className="card mb-4 h-[200px]" />
        <div className="card h-[400px]" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] no-underline">
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="card py-[60px] text-center">
          <p className="mb-2 text-[var(--muted)]">No active {title} market found.</p>
          <p className="text-xs text-[#2d2e45]">Markets are created daily at 00:00 ET.</p>
        </div>
      </div>
    );
  }

  const marketTypeClass =
    marketType === "receipts"
      ? "bg-[#6c7aff]/[0.12] text-[#6c7aff]"
      : "bg-[#f0a832]/[0.12] text-[#f0a832]";

  return (
    <div className="fade-up mx-auto max-w-[1200px]">
      <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] no-underline transition-colors duration-150 hover:text-[var(--foreground)]">
        <ArrowLeft size={14} /> Back to Markets
      </Link>

      {/* Header card */}
      <div className="card mb-4 px-7 py-6">
        <div className="flex items-start justify-between gap-5">
          <div className="flex-1">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className={`rounded px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] ${marketTypeClass}`}>
                {marketType === "receipts" ? "Receipts" : "NAM Distribution"}
              </span>
              <span className={`rounded px-2 py-[3px] text-[10px] font-bold ${
                market.resolved
                  ? "bg-yes/[0.08] text-yes"
                  : "bg-white/[0.04] text-[#8081a0]"
              }`}>
                {market.resolved ? "RESOLVED" : "ACTIVE"}
              </span>
            </div>
            <h1 className="mb-2 text-xl font-bold text-[var(--foreground)]">{market.question}</h1>
            <p className="text-xs text-[var(--muted)]">{description}</p>
          </div>

          {!market.resolved && (
            <div className="shrink-0 text-center">
              <div className="flex items-center gap-1">
                {[{ v: countdown.h, l: "H" }, { v: countdown.m, l: "M" }, { v: countdown.s, l: "S" }].map(({ v, l }) => (
                  <div key={l} className="text-center">
                    <div className="mono min-w-10 rounded-md bg-white/[0.04] px-2 py-1 text-[22px] font-bold text-[var(--foreground)]">{v}</div>
                    <div className="mt-0.5 text-[9px] text-[var(--muted)]">{l}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-[var(--muted)]">Resolves {market.date}</p>
            </div>
          )}
          {market.resolved && market.winningRangeIndex != null && (
            <div className="shrink-0 text-center">
              <p className="mb-1 text-[11px] text-[var(--muted)]">Winner</p>
              <p className={`text-lg font-bold ${RANGE_TEXT_CLASSES[market.winningRangeIndex % RANGE_TEXT_CLASSES.length]}`}>
                {ranges[market.winningRangeIndex]?.label}
              </p>
            </div>
          )}
        </div>
      </div>

      <RangeProbabilityChart
        ranges={ranges}
        trades={trades}
        currentPrices={prices}
        colors={RANGE_COLORS}
        marketCreatedAt={market.createdAt}
      />

      {/* Main content */}
      <div className="grid grid-cols-[1fr_360px] items-start gap-4">
        {/* Range selection */}
        <div className="card p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[var(--foreground)]">
            Outcomes
            <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">probabilities sum to 100%</span>
          </h2>
          <div className="flex flex-col gap-2.5">
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
            <div className="mt-4 border-t border-white/[0.05] pt-3.5">
              <p className="mb-2.5 text-[11px] text-[var(--muted)]">Your Positions</p>
              <div className="flex flex-col gap-1.5">
                {positions.filter((p) => parseFloat(p.balance) > 0).map((p) => {
                  const range = ranges[p.rangeIndex];
                  const rangeClass = RANGE_TEXT_CLASSES[p.rangeIndex % RANGE_TEXT_CLASSES.length];
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-2">
                      <span className={`text-xs font-semibold ${rangeClass}`}>{range?.label ?? `Range ${p.rangeIndex}`}</span>
                      <div className="text-right">
                        <span className="mono text-xs text-[var(--foreground)]">{parseFloat(p.balance).toFixed(2)} tokens</span>
                        <span className="ml-2 text-[10px] text-[var(--muted)]">@{(p.avgEntryPrice * 100).toFixed(1)}¢ avg</span>
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
