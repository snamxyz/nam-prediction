"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits } from "viem";
import { base } from "viem/chains";
import {
  TRADING_DOMAIN,
  TRADE_INTENT_TYPES,
  TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";
import { useAuth } from "@/hooks/useAuth";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { usePortfolio } from "@/hooks/usePortfolio";
import { fetchApi, authedPostApi } from "@/lib/api";
import { toast } from "sonner";

const QUICK = [1, 5, 10, 100];
const SELL_PERCENTS = [25, 50, 100] as const;
const DUST = 1e-6;
const SLIPPAGE_PRESETS = [0.5, 1, 2, 5];
const WARN_PRICE_IMPACT_PCT = 5;

interface TradePanelProps {
  marketId: number;
  onChainMarketId: number;
  ammAddress: `0x${string}`;
  yesPrice: number;
  noPrice: number;
}

interface EstimateBuyResponse {
  sharesOut: string;
  sharesOutRaw?: string;
  avgPrice: string;
  potentialPayout: string;
}

interface EstimateSellResponse {
  usdcOut: string;
  usdcOutRaw?: string;
  avgPrice: string;
}

interface NonceResponse {
  wallet: string;
  nonce: string;
  suggestedDeadline: string;
}

export function TradePanel({ marketId, onChainMarketId, ammAddress, yesPrice, noPrice }: TradePanelProps) {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { usdcBalance, refetch: refetchBalance } = useVaultBalance();
  const { data: positions } = usePortfolio();
  const queryClient = useQueryClient();

  const position = useMemo(
    () => positions?.find((p) => p.marketId === marketId),
    [positions, marketId]
  );
  const yesSharesStr = position?.yesBalance ?? "0";
  const noSharesStr = position?.noBalance ?? "0";
  const yesShares = parseFloat(yesSharesStr) || 0;
  const noShares = parseFloat(noSharesStr) || 0;

  const [mode, setMode] = useState<"BUY" | "SELL">("BUY");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estimate, setEstimate] = useState<
    | { shares?: string; sharesRaw?: string; usdc?: string; usdcRaw?: string; avgPrice?: string }
    | null
  >(null);

  // Fetch estimate when amount changes
  useEffect(() => {
    const num = parseFloat(amount) || 0;
    if (num <= 0) {
      setEstimate(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        if (mode === "BUY") {
          const data = await fetchApi<EstimateBuyResponse>(
            `/trading/estimate-buy?marketId=${marketId}&side=${side.toLowerCase()}&usdcAmount=${amount}`
          );
          setEstimate({ shares: data.sharesOut, sharesRaw: data.sharesOutRaw, avgPrice: data.avgPrice });
        } else {
          const data = await fetchApi<EstimateSellResponse>(
            `/trading/estimate-sell?marketId=${marketId}&side=${side.toLowerCase()}&sharesAmount=${amount}`
          );
          setEstimate({ usdc: data.usdcOut, usdcRaw: data.usdcOutRaw, avgPrice: data.avgPrice });
        }
      } catch {
        setEstimate(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [amount, side, mode, marketId]);

  const handleTrade = async () => {
    if (!address || !amount || !wallets.length) return;
    setIsLoading(true);
    setError(null);
    const toastId = `trade-${Date.now()}`;
    const amountLabel = amount;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      // Build the wallet client for signing
      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: base,
        transport: custom(provider),
      });

      // Parse amount in the correct units
      const amountRaw =
        mode === "BUY" ? parseUnits(amount, 6) : parseUnits(amount, 18);

      // Derive slippage floor from the last quoted estimate
      const slippageBps = BigInt(Math.round(slippagePct * 100));
      const BPS_DENOM = BigInt(10000);
      let minOutput = BigInt(0);
      if (mode === "BUY" && estimate?.sharesRaw) {
        const expected = BigInt(estimate.sharesRaw);
        minOutput = (expected * (BPS_DENOM - slippageBps)) / BPS_DENOM;
      } else if (mode === "SELL" && estimate?.usdcRaw) {
        const expected = BigInt(estimate.usdcRaw);
        minOutput = (expected * (BPS_DENOM - slippageBps)) / BPS_DENOM;
      }

      toast.loading("Preparing trade\u2026", { id: toastId });
      const { nonce, suggestedDeadline } = await fetchApi<NonceResponse>(
        `/trading/nonce/${address}`
      );
      const deadline = BigInt(suggestedDeadline);

      toast.loading("Sign the trade in your wallet\u2026", { id: toastId });
      const signature = await walletClient.signTypedData({
        account: address,
        domain: { ...TRADING_DOMAIN, chainId: base.id },
        types: TRADE_INTENT_TYPES,
        primaryType: TRADE_INTENT_PRIMARY_TYPE,
        message: {
          trader: address,
          marketId: BigInt(onChainMarketId),
          ammAddress,
          isYes: side === "YES",
          isBuy: mode === "BUY",
          amount: amountRaw,
          minOutput,
          nonce: BigInt(nonce),
          deadline,
        },
      });

      toast.loading("Submitting trade\u2026", { id: toastId });
      const endpoint = mode === "BUY" ? "/trading/buy" : "/trading/sell";
      await authedPostApi(
        endpoint,
        {
          marketId,
          side,
          amount: amountRaw.toString(),
          minOutput: minOutput.toString(),
          nonce,
          deadline: deadline.toString(),
          signature,
        },
        token
      );

      // Refresh data (indexer will also push via websocket within a few seconds)
      queryClient.invalidateQueries({ queryKey: ["market", String(marketId)] });
      queryClient.invalidateQueries({ queryKey: ["market-trades", String(marketId)] });
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio", address] });
      refetchBalance();

      const successMsg =
        mode === "BUY"
          ? `Bought ${side} \u00b7 $${amountLabel}`
          : `Sold ${side} \u00b7 ${amountLabel} shares`;
      toast.success(successMsg, { id: toastId });

      setAmount("");
      setEstimate(null);
    } catch (err: any) {
      console.error("Trade failed:", err);
      const msg = err.shortMessage || err.message || "Trade failed";
      // Users cancelling the signature prompt is not really an error worth shouting about.
      const isRejection = /user (rejected|denied)|rejected the request/i.test(msg);
      const display = isRejection ? "Signature rejected" : msg;
      setError(display);
      toast.error(display, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const num = parseFloat(amount) || 0;
  const price = side === "YES" ? yesPrice : noPrice;
  const isYes = side === "YES";
  const C = isYes ? "#01d243" : "#ff4757";

  // Display values
  const estimatedShares = estimate?.shares
    ? parseFloat(estimate.shares)
    : (mode === "BUY" && price > 0 ? num / price : 0);
  const estimatedUsdc = estimate?.usdc ? parseFloat(estimate.usdc) : 0;
  const avgPriceNum = estimate?.avgPrice ? parseFloat(estimate.avgPrice) : price;

  // Price impact % vs the mid-price the user saw pre-trade.
  const priceImpactPct = useMemo(() => {
    if (!estimate?.avgPrice || price <= 0) return 0;
    const avg = parseFloat(estimate.avgPrice);
    if (!Number.isFinite(avg) || avg <= 0) return 0;
    if (mode === "BUY") {
      return ((avg - price) / price) * 100;
    }
    // Sell: user receives `avg` per share; lower than current price = impact.
    return ((price - avg) / price) * 100;
  }, [estimate?.avgPrice, price, mode]);

  const highImpact = priceImpactPct >= WARN_PRICE_IMPACT_PCT;

  const potentialPayout = mode === "BUY" ? estimatedShares : estimatedUsdc;
  const pct = num > 0 && mode === "BUY" ? ((potentialPayout - num) / num) * 100 : 0;

  const formatCents = (p: number) => `${(p * 100).toFixed(1)}¢`;

  const ownedSharesStr = side === "YES" ? yesSharesStr : noSharesStr;
  const ownedShares = side === "YES" ? yesShares : noShares;
  const formatShares = (n: number) =>
    n >= 1 ? n.toFixed(2) : n > 0 ? n.toFixed(4) : "0";

  // Fill the sell input from a percentage of the user's share balance.
  // For MAX we pass the raw decimal string straight through so we don't lose
  // precision (the EIP-712 intent re-parses this via parseUnits(amount, 18)).
  const setSellPercent = (pct: number) => {
    if (ownedShares <= 0) return;
    if (pct >= 100) {
      setAmount(ownedSharesStr);
      return;
    }
    const v = ownedShares * (pct / 100);
    setAmount(v.toFixed(6));
  };

  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "#e8e9ed" }}>Trade</h3>
          {isAuthenticated && (
            <span className="text-xs" style={{ color: "#717182" }}>
              Balance: <span style={{ color: "#01d243" }}>${parseFloat(usdcBalance).toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Buy / Sell mode toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(["BUY", "SELL"] as const).map((m) => {
            const active = mode === m;
            const mc = m === "BUY" ? "#01d243" : "#ff4757";
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(""); setEstimate(null); setError(null); }}
                className="py-2 rounded-lg text-xs font-bold transition-all inner-border"
                style={
                  active
                    ? { background: `${mc}22`, color: mc, borderColor: `${mc}4d` }
                    : { background: "rgba(31,32,40,0.50)", color: "#717182" }
                }
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Yes / No toggle */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {(["YES", "NO"] as const).map((s) => {
            const active = side === s;
            const sc = s === "YES" ? "#01d243" : "#ff4757";
            const sidePrice = s === "YES" ? yesPrice : noPrice;
            return (
              <button
                key={s}
                onClick={() => setSide(s)}
                className="py-2.5 rounded-lg text-sm font-semibold transition-all inner-border"
                style={
                  active
                    ? { background: `${sc}33`, color: sc, borderColor: `${sc}4d` }
                    : { background: "rgba(31,32,40,0.50)", color: "#717182" }
                }
              >
                {s === "YES" ? "Yes" : "No"} {formatCents(sidePrice)}
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs" style={{ color: "#717182" }}>
            {mode === "BUY" ? "Amount (USDC)" : "Shares to Sell"}
          </p>
          {mode === "SELL" && isAuthenticated && (
            <p className="text-xs" style={{ color: "#717182" }}>
              Owned:{" "}
              <span style={{ color: ownedShares > 0 ? C : "#717182", fontWeight: 600 }}>
                {formatShares(ownedShares)} {side}
              </span>
            </p>
          )}
        </div>
        <div className="relative mb-3">
          {mode === "BUY" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "#717182" }}>$</span>
          )}
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg pr-4 py-2.5 text-sm text-right outline-none inner-border"
            style={{
              background: "rgba(31,32,40,0.60)",
              color: "#e8e9ed",
              paddingLeft: mode === "BUY" ? "1.75rem" : "1rem",
            }}
          />
        </div>

        {/* Quick sell percentages */}
        {mode === "SELL" && (
          <div className="flex gap-2 mb-4">
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedShares <= 0;
              const label = p === 100 ? "MAX" : `${p}%`;
              return (
                <button
                  key={p}
                  onClick={() => setSellPercent(p)}
                  disabled={disabled}
                  className="flex-1 py-1.5 rounded-md text-xs transition-all inner-border"
                  style={{
                    background: "rgba(31,32,40,0.50)",
                    color: disabled ? "rgba(113,113,130,0.50)" : "#717182",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.background = "rgba(31,32,40,0.80)";
                    e.currentTarget.style.color = "#e8e9ed";
                  }}
                  onMouseLeave={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.background = "rgba(31,32,40,0.50)";
                    e.currentTarget.style.color = "#717182";
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick amounts (buy only) */}
        {mode === "BUY" && (
          <div className="flex gap-2 mb-4">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setAmount((s) => String((parseFloat(s) || 0) + q))}
                className="flex-1 py-1.5 rounded-md text-xs transition-all inner-border"
                style={{ background: "rgba(31,32,40,0.50)", color: "#717182" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(31,32,40,0.80)";
                  e.currentTarget.style.color = "#e8e9ed";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(31,32,40,0.50)";
                  e.currentTarget.style.color = "#717182";
                }}
              >
                +${q}
              </button>
            ))}
            <button
              onClick={() => setAmount(usdcBalance)}
              className="flex-1 py-1.5 rounded-md text-xs transition-all inner-border"
              style={{ background: "rgba(31,32,40,0.50)", color: "#717182" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(31,32,40,0.80)";
                e.currentTarget.style.color = "#e8e9ed";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(31,32,40,0.50)";
                e.currentTarget.style.color = "#717182";
              }}
            >
              Max
            </button>
          </div>
        )}

        {/* Slippage tolerance */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs" style={{ color: "#717182" }}>Max slippage</p>
          <div className="flex items-center gap-1.5">
            {SLIPPAGE_PRESETS.map((s) => {
              const active = slippagePct === s;
              return (
                <button
                  key={s}
                  onClick={() => setSlippagePct(s)}
                  className="px-2 py-1 rounded text-[11px] transition-all inner-border"
                  style={
                    active
                      ? { background: "rgba(1,210,67,0.15)", color: "#01d243", borderColor: "rgba(1,210,67,0.30)" }
                      : { background: "rgba(31,32,40,0.50)", color: "#717182" }
                  }
                >
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div className="rounded-xl p-4 mb-5 inner-border" style={{ background: "rgba(31,32,40,0.50)" }}>
          <div className="flex justify-between text-xs mb-2.5">
            <span style={{ color: "#717182" }}>Avg price</span>
            <span style={{ color: "#e8e9ed" }}>
              {estimate?.avgPrice ? formatCents(avgPriceNum) : formatCents(price)}
            </span>
          </div>

          {num > 0 && (
            <div className="flex justify-between text-xs mb-2.5">
              <span style={{ color: "#717182" }}>Price impact</span>
              <span style={{ color: highImpact ? "#ff4757" : "#e8e9ed" }}>
                {priceImpactPct.toFixed(2)}%
              </span>
            </div>
          )}

          {mode === "BUY" ? (
            <>
              <div className="flex justify-between text-xs mb-2.5">
                <span style={{ color: "#717182" }}>Shares</span>
                <span style={{ color: "#e8e9ed" }}>
                  {num > 0 ? estimatedShares.toFixed(4) : "—"}
                </span>
              </div>
              <div className="my-2.5" style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />
              <div className="flex justify-between text-xs mb-2.5">
                <span style={{ color: "#717182" }}>Potential return</span>
                <span style={{ color: num > 0 ? C : "#717182", fontWeight: num > 0 ? 600 : 400 }}>
                  {num > 0 ? `$${potentialPayout.toFixed(2)} (+${pct.toFixed(1)}%)` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: "#717182" }}>Payout if {side} wins</span>
                <span style={{ color: "rgba(232,233,237,0.80)" }}>
                  {num > 0 ? `$${potentialPayout.toFixed(2)}` : "—"}
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-xs">
              <span style={{ color: "#717182" }}>USDC received</span>
              <span style={{ color: num > 0 ? "#01d243" : "#717182", fontWeight: num > 0 ? 600 : 400 }}>
                {num > 0 ? `$${estimatedUsdc.toFixed(4)}` : "—"}
              </span>
            </div>
          )}
        </div>

        {/* Slippage warning */}
        {num > 0 && highImpact && (
          <p
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ color: "#ffa500", background: "rgba(255,165,0,0.10)", border: "0.5px solid rgba(255,165,0,0.25)" }}
          >
            ⚠ High price impact ({priceImpactPct.toFixed(2)}%). Consider a smaller trade size.
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ color: "#ff4757", background: "rgba(255,71,87,0.10)" }}>
            {error}
          </p>
        )}

        {/* Trade button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={{ background: "#01d243", color: "#000", cursor: "pointer" }}
          >
            Connect to Trade
          </button>
        ) : (
          <button
            onClick={handleTrade}
            disabled={!isConnected || num <= 0 || isLoading || !wallets.length}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={
              isConnected && num > 0 && !isLoading && wallets.length > 0
                ? { background: C, color: isYes ? "#000" : "#fff", cursor: "pointer" }
                : { background: "rgba(31,32,40,0.50)", color: "#717182", cursor: "not-allowed" }
            }
          >
            {isLoading
              ? "Processing…"
              : num > 0
              ? `${mode === "BUY" ? "Buy" : "Sell"} ${side} · ${mode === "BUY" ? `$${num.toFixed(2)}` : `${num} shares`}`
              : "Enter an amount"}
          </button>
        )}
        <p className="text-center text-[10px] mt-3" style={{ color: "rgba(113,113,130,0.50)" }}>
          Each trade requires a wallet signature. By trading, you agree to the Terms of Use.
        </p>

        {/* Current position summary */}
        {isAuthenticated && (yesShares >= DUST || noShares >= DUST) && (
          <div className="mt-4 rounded-xl p-4 inner-border" style={{ background: "rgba(31,32,40,0.50)" }}>
            <p className="text-xs font-semibold mb-3" style={{ color: "#717182" }}>Your Position</p>
            {yesShares >= DUST && (
              <div className="flex items-center justify-between text-xs mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "rgba(1,210,67,0.15)", color: "#01d243" }}>YES</span>
                  <span style={{ color: "#e8e9ed" }}>{yesShares.toFixed(4)} shares</span>
                  <span style={{ color: "#717182" }}>@ {(position?.yesAvgPrice ? position.yesAvgPrice * 100 : yesPrice * 100).toFixed(1)}¢</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "#e8e9ed" }}>${Number(position?.yesCurrentValue ?? 0).toFixed(2)}</span>
                  <span style={{ color: Number(position?.yesPnl ?? 0) >= 0 ? "#00e676" : "#ff4757" }}>
                    {Number(position?.yesPnl ?? 0) >= 0 ? "+" : ""}${Number(position?.yesPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {noShares >= DUST && (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "rgba(255,71,87,0.15)", color: "#ff4757" }}>NO</span>
                  <span style={{ color: "#e8e9ed" }}>{noShares.toFixed(4)} shares</span>
                  <span style={{ color: "#717182" }}>@ {(position?.noAvgPrice ? position.noAvgPrice * 100 : noPrice * 100).toFixed(1)}¢</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "#e8e9ed" }}>${Number(position?.noCurrentValue ?? 0).toFixed(2)}</span>
                  <span style={{ color: Number(position?.noPnl ?? 0) >= 0 ? "#00e676" : "#ff4757" }}>
                    {Number(position?.noPnl ?? 0) >= 0 ? "+" : ""}${Number(position?.noPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
