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
import { usePortfolio, type BinaryPositionWithMarket, type PositionWithMarket } from "@/hooks/usePortfolio";
import { fetchApi, authedPostApi } from "@/lib/api";
import type { OutcomeDisplayLabels } from "@/lib/marketDisplay";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const QUICK = [1, 5, 10, 100];
const SELL_PERCENTS = [25, 50, 100] as const;
const DUST = 1e-6;
const SLIPPAGE_PRESETS = [0.5, 1, 2, 5];
const WARN_PRICE_IMPACT_PCT = 5;

function isBinaryPosition(pos: PositionWithMarket): pos is BinaryPositionWithMarket {
  return (pos.positionType ?? "binary") === "binary";
}

interface TradePanelProps {
  marketId: number;
  onChainMarketId: number;
  ammAddress: `0x${string}`;
  yesPrice: number;
  noPrice: number;
  outcomeLabels?: OutcomeDisplayLabels;
  defaultSide?: "YES" | "NO";
}

interface EstimateBuyResponse {
  sharesOut: string;
  sharesOutRaw?: string;
  avgPrice: string;
  potentialPayout: string;
  tradeAmount?: string;
  protocolFee?: string;
  protocolFeeRaw?: string;
  netAmount?: string;
  netAmountRaw?: string;
  lpFeeBps?: string;
  protocolFeeBps?: string;
}

interface EstimateSellResponse {
  usdcOut: string;
  usdcOutRaw?: string;
  avgPrice: string;
  grossAmount?: string;
  grossAmountRaw?: string;
  protocolFee?: string;
  protocolFeeRaw?: string;
  netAmount?: string;
  netAmountRaw?: string;
  lpFeeBps?: string;
  protocolFeeBps?: string;
}

interface NonceResponse {
  wallet: string;
  nonce: string;
  suggestedDeadline: string;
}

export function TradePanel({ marketId, onChainMarketId, ammAddress, yesPrice, noPrice, outcomeLabels, defaultSide = "YES" }: TradePanelProps) {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { usdcBalance, refetch: refetchBalance } = useVaultBalance();
  const { data: positions } = usePortfolio();
  const queryClient = useQueryClient();

  const position = useMemo(
    () => positions?.find((p): p is BinaryPositionWithMarket => isBinaryPosition(p) && p.marketId === marketId),
    [positions, marketId]
  );
  const yesSharesStr = position?.yesBalance ?? "0";
  const noSharesStr = position?.noBalance ?? "0";
  const yesShares = parseFloat(yesSharesStr) || 0;
  const noShares = parseFloat(noSharesStr) || 0;

  const [mode, setMode] = useState<"BUY" | "SELL">("BUY");
  const [side, setSide] = useState<"YES" | "NO">(defaultSide);
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estimate, setEstimate] = useState<
    | {
        shares?: string;
        sharesRaw?: string;
        usdc?: string;
        usdcRaw?: string;
        avgPrice?: string;
        tradeAmount?: string;
        netAmount?: string;
        grossAmount?: string;
        protocolFee?: string;
        protocolFeeBps?: string;
      }
    | null
  >(null);

  useEffect(() => {
    setSide(defaultSide);
    setAmount("");
    setEstimate(null);
    setError(null);
  }, [defaultSide]);

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
          setEstimate({
            shares: data.sharesOut,
            sharesRaw: data.sharesOutRaw,
            avgPrice: data.avgPrice,
            tradeAmount: data.tradeAmount,
            netAmount: data.netAmount,
            protocolFee: data.protocolFee,
            protocolFeeBps: data.protocolFeeBps,
          });
        } else {
          const data = await fetchApi<EstimateSellResponse>(
            `/trading/estimate-sell?marketId=${marketId}&side=${side.toLowerCase()}&sharesAmount=${amount}`
          );
          setEstimate({
            usdc: data.usdcOut,
            usdcRaw: data.usdcOutRaw,
            avgPrice: data.avgPrice,
            grossAmount: data.grossAmount,
            netAmount: data.netAmount,
            protocolFee: data.protocolFee,
            protocolFeeBps: data.protocolFeeBps,
          });
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
  const sideAccentClass = isYes ? "text-yes" : "text-no";
  const sideButtonClass = isYes ? "bg-yes text-black" : "bg-no text-white";
  const labels = outcomeLabels ?? { yes: "Yes", no: "No", yesShort: "YES", noShort: "NO" };
  const sideLabel = isYes ? labels.yes : labels.no;
  const sideShortLabel = isYes ? labels.yesShort : labels.noShort;

  // Display values
  const estimatedShares = estimate?.shares
    ? parseFloat(estimate.shares)
    : (mode === "BUY" && price > 0 ? num / price : 0);
  const estimatedUsdc = estimate?.usdc ? parseFloat(estimate.usdc) : 0;
  const avgPriceNum = estimate?.avgPrice ? parseFloat(estimate.avgPrice) : price;

  // Fee breakdown values
  const protocolFeeNum = estimate?.protocolFee ? parseFloat(estimate.protocolFee) : 0;
  const netAmountNum = estimate?.netAmount ? parseFloat(estimate.netAmount) : 0;
  const grossAmountNum = estimate?.grossAmount ? parseFloat(estimate.grossAmount) : 0;
  const protocolFeePctLabel = estimate?.protocolFeeBps
    ? `${(Number(estimate.protocolFeeBps) / 100).toFixed(2)}%`
    : "";

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
  const yesAvgDisplay = position?.yesAvgPrice ?? yesPrice;
  const noAvgDisplay = position?.noAvgPrice ?? noPrice;

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
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/[0.04] px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Trade</h3>
          {isAuthenticated && (
            <span className="mono text-[11px] text-[var(--muted)]">
              Balance: <span className="text-yes">${parseFloat(usdcBalance).toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        {/* Buy / Sell mode toggle */}
        <div className="mb-3.5 grid grid-cols-2 gap-1.5">
          {(["BUY", "SELL"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(""); setEstimate(null); setError(null); }}
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

        {/* Outcome toggle */}
        <div className="mb-[18px] grid grid-cols-2 gap-1.5">
          {(["YES", "NO"] as const).map((s) => {
            const active = side === s;
            const sidePrice = s === "YES" ? yesPrice : noPrice;
            return (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`cursor-pointer rounded-lg border py-2.5 text-[13px] font-semibold transition-all duration-150 ${
                  active
                    ? s === "YES"
                      ? "border-yes/30 bg-yes/15 text-yes"
                      : "border-no/30 bg-no/15 text-no"
                    : "border-white/[0.04] bg-[var(--surface-hover)] text-[var(--muted)]"
                }`}
              >
                {s === "YES" ? labels.yes : labels.no} {formatCents(sidePrice)}
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] text-[var(--muted)]">
            {mode === "BUY" ? "Amount (USDC)" : "Shares to Sell"}
          </p>
          {mode === "SELL" && isAuthenticated && (
            <p className="text-[11px] text-[var(--muted)]">
              Owned:{" "}
              <span className={`font-semibold ${ownedShares > 0 ? sideAccentClass : "text-[var(--muted)]"}`}>
                {formatShares(ownedShares)} {sideShortLabel}
              </span>
            </p>
          )}
        </div>
        <div className="relative mb-2.5">
          {mode === "BUY" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--muted)]">$</span>
          )}
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`mono w-full rounded-lg border border-white/[0.04] bg-[var(--surface-hover)] py-2.5 pr-3.5 text-right text-[13px] text-[var(--foreground)] outline-none ${
              mode === "BUY" ? "pl-7" : "pl-3.5"
            }`}
          />
        </div>

        {/* Quick sell percentages */}
        {mode === "SELL" && (
          <div className="mb-3.5 flex gap-1.5">
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedShares <= 0;
              const label = p === 100 ? "MAX" : `${p}%`;
              return (
                <button
                  key={p}
                  onClick={() => setSellPercent(p)}
                  disabled={disabled}
                  className={`flex-1 rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] transition-all duration-150 ${
                    disabled
                      ? "cursor-not-allowed text-[var(--muted)]/50"
                      : "cursor-pointer text-[var(--muted)] hover:bg-[#1a1c2a] hover:text-[var(--foreground)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick amounts (buy only) */}
        {mode === "BUY" && (
          <div className="mb-3.5 flex gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setAmount((s) => String((parseFloat(s) || 0) + q))}
                className="flex-1 cursor-pointer rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)] transition-all duration-150 hover:bg-[#1a1c2a] hover:text-[var(--foreground)]"
              >
                +${q}
              </button>
            ))}
            <button
              onClick={() => setAmount(usdcBalance)}
              className="flex-1 cursor-pointer rounded-md border border-white/[0.04] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)] transition-all duration-150 hover:bg-[#1a1c2a] hover:text-[var(--foreground)]"
            >
              Max
            </button>
          </div>
        )}

        {/* Slippage tolerance */}
        <div className="mb-[18px] flex items-center justify-between">
          <p className="text-[11px] text-[var(--muted)]">Max slippage</p>
          <div className="flex items-center gap-1">
            {SLIPPAGE_PRESETS.map((s) => {
              const active = slippagePct === s;
              return (
                <button
                  key={s}
                  onClick={() => setSlippagePct(s)}
                  className={`cursor-pointer rounded border px-2 py-1 text-[10px] transition-all duration-150 ${
                    active
                      ? "border-yes/30 bg-yes/[0.12] text-yes"
                      : "border-white/[0.04] bg-[var(--surface-hover)] text-[var(--muted)]"
                  }`}
                >
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div className="mb-[18px] rounded-[10px] border border-white/[0.04] bg-[var(--surface-hover)] p-3.5">
          <div className="mb-2 flex justify-between text-[11px]">
            <span className="text-[var(--muted)]">Avg price</span>
            <span className="mono text-[var(--foreground)]">
              {estimate?.avgPrice ? formatCents(avgPriceNum) : formatCents(price)}
            </span>
          </div>

          {num > 0 && (
            <div className="mb-2 flex justify-between text-[11px]">
              <span className="text-[var(--muted)]">Price impact</span>
              <span className={`mono ${highImpact ? "text-no" : "text-[var(--foreground)]"}`}>
                {priceImpactPct.toFixed(2)}%
              </span>
            </div>
          )}

          {mode === "BUY" ? (
            <>
              {num > 0 && (
                <>
                  <div className="mb-2 flex justify-between text-[11px]">
                    <span className="text-[var(--muted)]">Trade amount</span>
                    <span className="mono text-[var(--foreground)]">
                      ${num.toFixed(4)}
                    </span>
                  </div>
                  {protocolFeeNum > 0 && (
                    <>
                      <div className="mb-2 flex justify-between text-[11px]">
                        <span className="text-[var(--muted)]">
                          Protocol fee{protocolFeePctLabel ? ` (${protocolFeePctLabel})` : ""}
                        </span>
                        <span className="mono text-[#ffa500]">
                          −${protocolFeeNum.toFixed(4)}
                        </span>
                      </div>
                      <div className="mb-2 flex justify-between text-[11px]">
                        <span className="text-[var(--muted)]">Net trade amount</span>
                        <span className="mono text-[var(--foreground)]">
                          ${netAmountNum.toFixed(4)}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="mb-2 flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Shares</span>
                <span className="mono text-[var(--foreground)]">
                  {num > 0 ? estimatedShares.toFixed(4) : "—"}
                </span>
              </div>
              <div className="my-2 h-px bg-white/[0.04]" />
              <div className="mb-2 flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Potential return</span>
                <span className={`mono ${num > 0 ? `${sideAccentClass} font-semibold` : "text-[var(--muted)] font-normal"}`}>
                  {num > 0 ? `$${potentialPayout.toFixed(2)} (+${pct.toFixed(1)}%)` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">Payout if {sideLabel} wins</span>
                <span className="mono text-[var(--foreground)]/80">
                  {num > 0 ? `$${potentialPayout.toFixed(2)}` : "—"}
                </span>
              </div>
            </>
          ) : (
            <>
              {num > 0 && grossAmountNum > 0 && (
                <>
                  <div className="mb-2 flex justify-between text-[11px]">
                    <span className="text-[var(--muted)]">Gross proceeds</span>
                    <span className="mono text-[var(--foreground)]">
                      ${grossAmountNum.toFixed(4)}
                    </span>
                  </div>
                  {protocolFeeNum > 0 && (
                    <div className="mb-2 flex justify-between text-[11px]">
                      <span className="text-[var(--muted)]">
                        Protocol fee{protocolFeePctLabel ? ` (${protocolFeePctLabel})` : ""}
                      </span>
                      <span className="mono text-[#ffa500]">
                        −${protocolFeeNum.toFixed(4)}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">USDC received</span>
                <span className={`mono ${num > 0 ? "font-semibold text-yes" : "font-normal text-[var(--muted)]"}`}>
                  {num > 0 ? `$${estimatedUsdc.toFixed(4)}` : "—"}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Slippage warning */}
        {num > 0 && highImpact && (
          <p className="mb-2.5 rounded-lg border border-[#ffa500]/20 bg-[#ffa500]/[0.08] px-3 py-2 text-[11px] text-[#ffa500]">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              High price impact ({priceImpactPct.toFixed(2)}%). Consider a smaller trade size.
            </span>
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="mb-2.5 rounded-lg bg-no/[0.08] px-3 py-2 text-[11px] text-no">
            {error}
          </p>
        )}

        {/* Trade button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full cursor-pointer rounded-[10px] border-0 bg-yes py-3 text-[13px] font-bold text-black"
          >
            Connect to Trade
          </button>
        ) : (
          <button
            onClick={handleTrade}
            disabled={!isConnected || num <= 0 || isLoading || !wallets.length}
            className={`w-full rounded-[10px] border-0 py-3 text-[13px] font-bold transition-all duration-150 ${
              isConnected && num > 0 && !isLoading && wallets.length > 0
                ? `cursor-pointer ${sideButtonClass}`
                : "cursor-not-allowed bg-[var(--surface-hover)] text-[var(--muted)]"
            }`}
          >
            {isLoading
              ? "Processing…"
              : num > 0
              ? `${mode === "BUY" ? "Buy" : "Sell"} ${sideLabel} · ${mode === "BUY" ? `$${num.toFixed(2)}` : `${num} shares`}`
              : "Enter an amount"}
          </button>
        )}
        <p className="mt-2.5 text-center text-[9px] text-[var(--muted)]/50">
          Each trade requires a wallet signature. By trading, you agree to the Terms of Use.
        </p>

        {/* Current position summary */}
        {isAuthenticated && (yesShares >= DUST || noShares >= DUST) && (
          <div className="mt-3.5 rounded-[10px] border border-white/[0.04] bg-[var(--surface-hover)] p-3.5">
            <p className="mb-2.5 text-[11px] font-semibold text-[var(--muted)]">Your Position</p>
            {yesShares >= DUST && (
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-yes/[0.12] px-1.5 py-0.5 text-[9px] font-bold text-yes">{labels.yesShort}</span>
                  <span className="mono text-[var(--foreground)]">{yesShares.toFixed(4)} shares</span>
                  <span className="mono text-[var(--muted)]">@ {(yesAvgDisplay * 100).toFixed(1)}¢</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mono text-[var(--foreground)]">${Number(position?.yesCurrentValue ?? 0).toFixed(2)}</span>
                  <span className={`mono ${Number(position?.yesPnl ?? 0) >= 0 ? "text-yes" : "text-no"}`}>
                    {Number(position?.yesPnl ?? 0) >= 0 ? "+" : ""}${Number(position?.yesPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {noShares >= DUST && (
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-no/[0.12] px-1.5 py-0.5 text-[9px] font-bold text-no">{labels.noShort}</span>
                  <span className="mono text-[var(--foreground)]">{noShares.toFixed(4)} shares</span>
                  <span className="mono text-[var(--muted)]">@ {(noAvgDisplay * 100).toFixed(1)}¢</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mono text-[var(--foreground)]">${Number(position?.noCurrentValue ?? 0).toFixed(2)}</span>
                  <span className={`mono ${Number(position?.noPnl ?? 0) >= 0 ? "text-yes" : "text-no"}`}>
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
