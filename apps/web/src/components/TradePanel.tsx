"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { createWalletClient, custom, formatUnits, parseUnits } from "viem";
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
import { floorBalance } from "@/lib/format";
import type { OutcomeDisplayLabels } from "@/lib/marketDisplay";
import { usePreferredWallet } from "@/hooks/usePreferredWallet";
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
  priceImpactPct?: string;
  poolLiquidity?: string;
  poolCollateral?: string;
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

interface ShareBalanceResponse {
  balance: string;
  balanceRaw: string;
}

export function TradePanel({ marketId, onChainMarketId, ammAddress, yesPrice, noPrice, outcomeLabels, defaultSide = "YES" }: TradePanelProps) {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, login } = useAuth();
  const { getAccessToken } = usePrivy();
  const preferredWallet = usePreferredWallet();
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
  const [justTraded, setJustTraded] = useState(false);
  const [sellMaxSelected, setSellMaxSelected] = useState(false);
  const justTradedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        priceImpactPct?: string;
        poolLiquidity?: string;
        poolCollateral?: string;
        quoteAmount?: string;
        quoteSide?: "YES" | "NO";
        quoteMode?: "BUY" | "SELL";
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
    setEstimate(null);

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
            priceImpactPct: data.priceImpactPct,
            poolLiquidity: data.poolLiquidity,
            poolCollateral: data.poolCollateral,
            quoteAmount: amount,
            quoteSide: side,
            quoteMode: "BUY",
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
            quoteAmount: amount,
            quoteSide: side,
            quoteMode: "SELL",
          });
        }
      } catch {
        setEstimate(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [amount, side, mode, marketId]);

  const handleTrade = async () => {
    if (!preferredWallet || !amount) return;
    setIsLoading(true);
    setError(null);
    const toastId = `trade-${Date.now()}`;
    const amountLabel = amount;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      // Build the wallet client for signing
      const wallet = preferredWallet;
      const signerAddress = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: signerAddress,
        chain: base,
        transport: custom(provider),
      });

      let tradeAmount = amount;
      let tradeEstimate = estimate;
      let amountRaw =
        mode === "BUY" ? parseUnits(tradeAmount, 6) : parseUnits(tradeAmount, 18);

      if (mode === "SELL") {
        const balance = await fetchApi<ShareBalanceResponse>(
          `/trading/share-balance?marketId=${marketId}&side=${side.toLowerCase()}&wallet=${signerAddress}`
        );
        const liveBalanceRaw = BigInt(balance.balanceRaw);

        if (sellMaxSelected) {
          // Leave one wei behind so MAX cannot overshoot because of DB/indexer
          // drift, decimal formatting, or a just-confirmed prior sell.
          const zero = BigInt(0);
          const oneWei = BigInt(1);
          const safeRaw = liveBalanceRaw > zero ? liveBalanceRaw - oneWei : zero;
          if (safeRaw <= zero) throw new Error("Insufficient share balance");
          amountRaw = safeRaw;
          tradeAmount = formatUnits(safeRaw, 18);
        } else if (amountRaw > liveBalanceRaw) {
          throw new Error("Insufficient share balance");
        }

        if (
          !tradeEstimate ||
          tradeEstimate.quoteMode !== "SELL" ||
          tradeEstimate.quoteSide !== side ||
          tradeEstimate.quoteAmount !== tradeAmount
        ) {
          const quoted = await fetchApi<EstimateSellResponse>(
            `/trading/estimate-sell?marketId=${marketId}&side=${side.toLowerCase()}&sharesAmount=${tradeAmount}`
          );
          tradeEstimate = {
            usdc: quoted.usdcOut,
            usdcRaw: quoted.usdcOutRaw,
            avgPrice: quoted.avgPrice,
            grossAmount: quoted.grossAmount,
            netAmount: quoted.netAmount,
            protocolFee: quoted.protocolFee,
            protocolFeeBps: quoted.protocolFeeBps,
            quoteAmount: tradeAmount,
            quoteSide: side,
            quoteMode: "SELL",
          };
          setEstimate(tradeEstimate);
          setAmount(tradeAmount);
        }
      }

      // Derive slippage floor from the last quoted estimate
      const slippageBps = BigInt(Math.round(slippagePct * 100));
      const BPS_DENOM = BigInt(10000);
      let minOutput = BigInt(0);
      if (mode === "BUY" && tradeEstimate?.sharesRaw) {
        const expected = BigInt(tradeEstimate.sharesRaw);
        minOutput = (expected * (BPS_DENOM - slippageBps)) / BPS_DENOM;
      } else if (mode === "SELL" && tradeEstimate?.usdcRaw) {
        const expected = BigInt(tradeEstimate.usdcRaw);
        minOutput = (expected * (BPS_DENOM - slippageBps)) / BPS_DENOM;
      }

      toast.loading("Preparing trade\u2026", { id: toastId });
      const { nonce, suggestedDeadline } = await fetchApi<NonceResponse>(
        `/trading/nonce/${signerAddress}`
      );
      const deadline = BigInt(suggestedDeadline);

      toast.loading("Sign the trade in your wallet\u2026", { id: toastId });
      const signature = await walletClient.signTypedData({
        account: signerAddress,
        domain: { ...TRADING_DOMAIN, chainId: base.id },
        types: TRADE_INTENT_TYPES,
        primaryType: TRADE_INTENT_PRIMARY_TYPE,
        message: {
          trader: signerAddress,
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
      queryClient.invalidateQueries({ queryKey: ["portfolio", signerAddress] });
      refetchBalance();

      const successMsg =
        mode === "BUY"
          ? `Bought ${side} \u00b7 $${amountLabel}`
          : `Sold ${side} \u00b7 ${tradeAmount} shares`;
      toast.success(successMsg, { id: toastId });

      // Trigger success animation
      setJustTraded(true);
      if (justTradedTimerRef.current) clearTimeout(justTradedTimerRef.current);
      justTradedTimerRef.current = setTimeout(() => setJustTraded(false), 800);

      setAmount("");
      setEstimate(null);
      setSellMaxSelected(false);
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
  const hasCurrentBuyEstimate =
    mode === "BUY" &&
    estimate?.quoteMode === "BUY" &&
    estimate.quoteAmount === amount &&
    estimate.quoteSide === side &&
    !!estimate.shares;
  const hasCurrentSellEstimate =
    mode === "SELL" &&
    estimate?.quoteMode === "SELL" &&
    estimate.quoteAmount === amount &&
    estimate.quoteSide === side &&
    !!estimate.usdc;
  const hasCurrentEstimate = mode === "BUY" ? hasCurrentBuyEstimate : hasCurrentSellEstimate;

  // Display values
  const estimatedShares = hasCurrentBuyEstimate && estimate?.shares ? parseFloat(estimate.shares) : 0;
  const estimatedUsdc = hasCurrentSellEstimate && estimate?.usdc ? parseFloat(estimate.usdc) : 0;
  const avgPriceNum = hasCurrentEstimate && estimate?.avgPrice ? parseFloat(estimate.avgPrice) : price;

  // Fee breakdown values
  const protocolFeeNum = hasCurrentEstimate && estimate?.protocolFee ? parseFloat(estimate.protocolFee) : 0;
  const netAmountNum = hasCurrentEstimate && estimate?.netAmount ? parseFloat(estimate.netAmount) : 0;
  const grossAmountNum = hasCurrentEstimate && estimate?.grossAmount ? parseFloat(estimate.grossAmount) : 0;
  const poolDepthNum = hasCurrentBuyEstimate && estimate?.poolCollateral
    ? parseFloat(estimate.poolCollateral)
    : hasCurrentBuyEstimate && estimate?.poolLiquidity
      ? parseFloat(estimate.poolLiquidity)
      : 0;
  const protocolFeePctLabel = hasCurrentEstimate && estimate?.protocolFeeBps
    ? `${(Number(estimate.protocolFeeBps) / 100).toFixed(2)}%`
    : "";

  // Slippage vs mid: how much worse the fill is than trading at the headline mid
  // (constant-product pools can show huge "avg vs mid %" even when the intuitive
  // gap is "you received X% fewer shares / USDC than the mid implied").
  const priceImpactPct = useMemo(() => {
    if (price <= 0 || !Number.isFinite(price)) return 0;
    if (mode === "BUY") {
      if (hasCurrentBuyEstimate && estimate?.priceImpactPct) {
        return parseFloat(estimate.priceImpactPct) || 0;
      }
      const midBasis =
        netAmountNum > 0 && Number.isFinite(netAmountNum) ? netAmountNum : num;
      if (midBasis <= 0) return 0;
      const idealShares = midBasis / price;
      if (!Number.isFinite(idealShares) || idealShares <= 0) return 0;
      if (!Number.isFinite(estimatedShares) || estimatedShares <= 0) return 0;
      return Math.max(0, ((idealShares - estimatedShares) / idealShares) * 100);
    }
    const idealUsdc = num * price;
    if (!Number.isFinite(idealUsdc) || idealUsdc <= 0) return 0;
    if (!Number.isFinite(estimatedUsdc) || estimatedUsdc <= 0) return 0;
    return Math.max(0, ((idealUsdc - estimatedUsdc) / idealUsdc) * 100);
  }, [
    mode,
    price,
    num,
    netAmountNum,
    estimatedShares,
    estimatedUsdc,
    hasCurrentBuyEstimate,
    estimate?.priceImpactPct,
  ]);

  const highImpact = priceImpactPct >= WARN_PRICE_IMPACT_PCT;

  const potentialPayout = mode === "BUY" && hasCurrentBuyEstimate ? estimatedShares : estimatedUsdc;
  const buyRoiPct =
    mode === "BUY" && num > 0 && hasCurrentBuyEstimate
      ? ((potentialPayout - num) / num) * 100
      : 0;
  const canSubmitTrade =
    isConnected &&
    num > 0 &&
    !isLoading &&
    !!preferredWallet &&
    (mode === "BUY" ? hasCurrentBuyEstimate : hasCurrentSellEstimate);

  const formatCents = (p: number) => `${(p * 100).toFixed(1)}¢`;
  /** USDC under $1 uses extra decimals so payouts are not rounded up to the cent. */
  const formatTradeUsd = (n: number) => {
    if (!Number.isFinite(n)) return "$0";
    const abs = Math.abs(n);
    const frac = abs >= 1 ? 2 : 4;
    return `$${n.toFixed(frac)}`;
  };
  /** Mid / spot outcome prices are 0–1; avg execution can exceed $1/share on thin liquidity. */
  const formatAvgOutcomePrice = (p: number) => {
    if (!Number.isFinite(p) || p <= 0) return "—";
    if (p > 1) return `$${p.toFixed(3)}/$1`;
    return formatCents(p);
  };
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
      setSellMaxSelected(true);
      return;
    }
    const v = ownedShares * (pct / 100);
    setAmount(v.toFixed(6));
    setSellMaxSelected(false);
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/[0.04] px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Trade</h3>
          {isAuthenticated && (
            <span className="mono text-[11px] text-[var(--muted)]">
              Balance: <span className="text-yes">${floorBalance(usdcBalance)}</span>
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
                onClick={() => { setMode(m); setAmount(""); setEstimate(null); setError(null); setSellMaxSelected(false); }}
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
                onClick={() => { setSide(s); setSellMaxSelected(false); }}
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
            onChange={(e) => { setAmount(e.target.value); setSellMaxSelected(false); }}
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
              {estimate?.avgPrice ? formatAvgOutcomePrice(avgPriceNum) : formatCents(price)}
            </span>
          </div>

          {num > 0 && (
            <div className="mb-2 flex justify-between text-[11px]">
              <span className="text-[var(--muted)]">Price impact (vs mid)</span>
              <span className={`mono ${highImpact ? "text-no" : "text-[var(--foreground)]"}`}>
                {hasCurrentEstimate ? `${priceImpactPct.toFixed(2)}%` : "Estimating…"}
              </span>
            </div>
          )}

          {mode === "BUY" && poolDepthNum > 0 && (
            <div className="mb-2 flex justify-between text-[11px]">
              <span className="text-[var(--muted)]">Pool depth</span>
              <span className="mono text-[var(--foreground)]">
                {formatTradeUsd(poolDepthNum)}
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
                  {num > 0 ? (hasCurrentBuyEstimate ? estimatedShares.toFixed(4) : "Estimating…") : "—"}
                </span>
              </div>
              <div className="my-2 h-px bg-white/[0.04]" />
              <div className="mb-2 flex justify-between gap-2 text-[11px]">
                <span className="shrink-0 text-[var(--muted)]">Potential return</span>
                <div className={`min-w-0 text-right ${num > 0 ? sideAccentClass : "text-[var(--muted)]"}`}>
                  {num > 0 && hasCurrentBuyEstimate ? (
                    <>
                      <span className="mono font-semibold">
                        {buyRoiPct >= 0 ? "+" : ""}
                        {buyRoiPct.toFixed(1)}%
                      </span>
                      <span className="mt-0.5 block font-sans text-[9px] font-normal leading-snug text-[var(--muted)]">
                        if {sideLabel} wins ($1/share) at quoted fill
                      </span>
                    </>
                  ) : (
                    <span className="mono font-normal">{num > 0 ? "Estimating…" : "—"}</span>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--muted)]">
                  Payout if {sideLabel} wins
                  {hasCurrentBuyEstimate && <span className="ml-1 text-[9px]">(quoted)</span>}
                </span>
                <span className="mono text-[var(--foreground)]/80">
                  {num > 0 ? (hasCurrentBuyEstimate ? formatTradeUsd(potentialPayout) : "Estimating…") : "—"}
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
            className="w-full cursor-pointer rounded-[10px] border-0 bg-yes py-3 text-[13px] font-bold text-black active:scale-[0.98] transition-transform duration-75"
          >
            Connect to Trade
          </button>
        ) : (
          <button
            onClick={handleTrade}
            disabled={!canSubmitTrade}
            className={[
              "w-full rounded-[10px] border-0 py-3 text-[13px] font-bold",
              "transition-transform duration-75 active:scale-[0.98]",
              canSubmitTrade && !isLoading
                ? `cursor-pointer ${sideButtonClass} ${justTraded ? "trade-success-btn" : "trade-ring-btn"}`
                : "cursor-not-allowed bg-[var(--surface-hover)] text-[var(--muted)]",
            ].join(" ")}
          >
            {isLoading
              ? <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Processing…
                </span>
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
