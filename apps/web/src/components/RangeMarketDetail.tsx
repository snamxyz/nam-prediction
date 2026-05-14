"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, AlertTriangle, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRangeActivity, useRangeMarketSocket, useRangePositions, useRangeMarkets, useRangeTrades } from "@/hooks/useRangeMarkets";
import type { RangeMarket, RangeOutcome, RangePosition } from "@nam-prediction/shared";
import {
  TRADING_DOMAIN,
  RANGE_TRADE_INTENT_TYPES,
  RANGE_TRADE_INTENT_PRIMARY_TYPE,
} from "@nam-prediction/shared";
import { fetchApi, authedPostApi } from "@/lib/api";
import { RangeProbabilityChart } from "@/components/RangeProbabilityChart";
import { RangeActivityChart } from "@/components/RangeActivityChart";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/UI/drawer";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { createWalletClient, custom, parseUnits } from "viem";
import { base } from "viem/chains";
import { toast } from "sonner";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { usePreferredWallet } from "@/hooks/usePreferredWallet";
import { formatEasternShortDate } from "@/lib/dateDisplay";
import { floorBalance } from "@/lib/format";
import { getRangeMarketAccent, getRangeMarketLabel, type RangeMarketKind } from "@/lib/rangeMarketDisplay";

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

function getMarketDayTime(market: Pick<RangeMarket, "date" | "endTime" | "createdAt">) {
  const dateTime = Date.parse(`${market.date}T00:00:00Z`);
  if (Number.isFinite(dateTime)) return dateTime;
  const endTime = Date.parse(market.endTime);
  if (Number.isFinite(endTime)) return endTime;
  return Date.parse(market.createdAt);
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
            ? "border-[var(--border-subtle)] bg-[var(--surface-hover)]"
            : "border-[var(--border-subtle)] bg-[var(--surface)]"
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
          className="block h-[3px] w-full rounded-full bg-[var(--surface-hover)]"
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
  const preferredWallet = usePreferredWallet();
  const { usdcBalance } = useVaultBalance();

  const [mode, setMode] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotedTokens, setQuotedTokens] = useState<number | null>(null);
  const [quotedSharesRaw, setQuotedSharesRaw] = useState<string | null>(null);
  const [quotedSellUsdc, setQuotedSellUsdc] = useState<number | null>(null);
  const [quotedSellUsdcRaw, setQuotedSellUsdcRaw] = useState<string | null>(null);
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
  const hasCurrentSellQuote =
    mode !== "SELL" ||
    (quotedSellUsdc !== null &&
      quotedSellUsdcRaw !== null &&
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
    if (selectedRangeIndex == null || num <= 0 || !market.rangeCpmmAddress) {
      setQuotedTokens(null);
      setQuotedSharesRaw(null);
      setQuotedSellUsdc(null);
      setQuotedSellUsdcRaw(null);
      setQuotedAmount("");
      setQuotedRangeIndex(null);
      return;
    }
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    quoteTimerRef.current = setTimeout(async () => {
      try {
        if (mode === "BUY") {
          const result = await fetchApi<{ rangeIndex: number; usdcAmount: number; sharesOut: string; sharesOutFloat: number }>(
            `/range-markets/${market.id}/quote?rangeIndex=${selectedRangeIndex}&usdcAmount=${num}`
          );
          setQuotedTokens(result.sharesOutFloat);
          setQuotedSharesRaw(result.sharesOut);
          setQuotedSellUsdc(null);
          setQuotedSellUsdcRaw(null);
        } else {
          const result = await fetchApi<{ rangeIndex: number; shares: number; usdcOutRaw: string; usdcOutFloat: number }>(
            `/range-markets/${market.id}/quote-sell?rangeIndex=${selectedRangeIndex}&shares=${encodeURIComponent(amount)}`
          );
          setQuotedTokens(null);
          setQuotedSharesRaw(null);
          setQuotedSellUsdc(result.usdcOutFloat);
          setQuotedSellUsdcRaw(result.usdcOutRaw);
        }
        setQuotedAmount(amount);
        setQuotedRangeIndex(selectedRangeIndex);
      } catch (err: unknown) {
        setQuotedTokens(null);
        setQuotedSharesRaw(null);
        setQuotedSellUsdc(null);
        setQuotedSellUsdcRaw(null);
        setQuotedAmount("");
        setQuotedRangeIndex(null);
        if (mode === "SELL") {
          setError((err as Error).message || "Sell quote unavailable");
        }
      }
    }, 400);
    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    };
  }, [mode, selectedRangeIndex, num, amount, market.id, market.rangeCpmmAddress]);

  const clearQuote = () => {
    setQuotedTokens(null);
    setQuotedSharesRaw(null);
    setQuotedSellUsdc(null);
    setQuotedSellUsdcRaw(null);
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
    if (!preferredWallet || !amount || selectedRangeIndex == null) return;
    if (!market.rangeCpmmAddress) return;

    setIsLoading(true);
    setError(null);
    const toastId = `range-trade-${Date.now()}`;

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const wallet = preferredWallet;
      const signerAddress = wallet.address as `0x${string}`;
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: signerAddress,
        chain: base,
        transport: custom(provider),
      });

      const amountRaw =
        mode === "BUY" ? parseUnits(amount, 6) : parseUnits(amount, 18);
      const slippageBps = BigInt(Math.round(slippagePct * 100));
      const minOutputRaw =
        mode === "BUY" && quotedSharesRaw && quotedAmount === amount && quotedRangeIndex === selectedRangeIndex
          ? (parseUnits(quotedSharesRaw, 18) * (BigInt(10_000) - slippageBps)) / BigInt(10_000)
          : mode === "SELL" && quotedSellUsdcRaw && quotedAmount === amount && quotedRangeIndex === selectedRangeIndex
            ? (BigInt(quotedSellUsdcRaw) * (BigInt(10_000) - slippageBps)) / BigInt(10_000)
          : BigInt(0);

      toast.loading("Preparing trade…", { id: toastId });
      const { nonce, suggestedDeadline } = await fetchApi<NonceResponse>(
        `/trading/nonce/${signerAddress}`
      );
      const deadline = BigInt(suggestedDeadline);

      toast.loading("Sign the trade in your wallet…", { id: toastId });
      const signature = await walletClient.signTypedData({
        account: signerAddress,
        domain: { ...TRADING_DOMAIN, chainId: base.id },
        types: RANGE_TRADE_INTENT_TYPES,
        primaryType: RANGE_TRADE_INTENT_PRIMARY_TYPE,
        message: {
          trader: signerAddress,
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
            : { shares: amount }),
          userAddress: signerAddress,
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
        <div className="border-b border-[var(--border-subtle)] px-5 py-4">
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
    !!preferredWallet &&
    selectedRangeIndex != null &&
    hasCurrentBuyQuote &&
    hasCurrentSellQuote &&
    (mode !== "SELL" || (ownedBalance > 0 && num <= ownedBalance));
  const selectedColorIndex =
    selectedRangeIndex != null ? selectedRangeIndex % RANGE_COLORS.length : 0;
  const selectedTextClass = RANGE_TEXT_CLASSES[selectedColorIndex];
  const selectedBgClass = RANGE_BG_CLASSES[selectedColorIndex];

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Trade</h3>
          {isAuthenticated && (
            <span className="mono text-[11px] text-[var(--muted)]">
              Balance:{" "}
              <span className="text-yes">
                ${floorBalance(usdcBalance)}
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
                    : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--muted)]"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {/* Selected range */}
        <div className="mb-[18px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 py-2.5">
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
            className={`mono w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] py-2.5 pr-3.5 text-right text-[13px] text-[var(--foreground)] outline-none ${
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
                className="flex-1 cursor-pointer rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)]">
                +${q}
              </button>
            ))}
            <button onClick={() => {
              setAmount(usdcBalance);
              clearQuote();
            }}
              className="flex-1 cursor-pointer rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] py-1.5 text-[11px] text-[var(--muted)]">
              Max
            </button>
          </div>
        ) : (
          <div className="mb-3.5 flex gap-1.5">
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedBalance <= 0;
              return (
                <button key={p} onClick={() => setSellPercent(p)} disabled={disabled}
                  className={`flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] py-1.5 text-[11px] ${
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
                      : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--muted)]"
                  }`}>
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div className="mb-[18px] rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3.5">
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
              <span className="text-[var(--muted)]">
                USDC received
                {quotedSellUsdc !== null && <span className="ml-1 text-[9px] text-[var(--muted)]">(exact)</span>}
              </span>
              <span className={`mono ${num > 0 ? "font-semibold text-yes" : "font-normal text-[var(--muted)]"}`}>
                {num > 0 ? `$${(quotedSellUsdc ?? num * selectedPrice).toFixed(4)}` : "—"}
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
          <div className="mt-3.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-3.5">
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
  marketType: RangeMarketKind;
  title: string;
  description: string;
}

export function RangeMarketDetail({ marketType, title, description }: RangeMarketDetailProps) {
  const searchParams = useSearchParams();
  const selectedMarketId = Number(searchParams.get("marketId"));
  const { data: allMarkets, isLoading, refetch } = useRangeMarkets(marketType);
  const market =
    allMarkets?.find((m) => Number.isFinite(selectedMarketId) && m.id === selectedMarketId) ??
    allMarkets?.find((m) => m.marketType === marketType && m.status === "active") ??
    allMarkets?.[0] ??
    null;
  const { livePrices, setLivePrices } = useRangeMarketSocket(market?.id);
  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const userAddress = user?.wallet?.address?.toLowerCase() ?? null;
  const { data: positions = [], refetch: refetchPositions } = useRangePositions(market?.id, userAddress ?? undefined);
  const { data: trades = [] } = useRangeTrades(market?.id);
  const { data: activity, isLoading: isActivityLoading } = useRangeActivity(market?.id);
  const [selectedRange, setSelectedRange] = useState<number | null>(null);
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [tab, setTab] = useState<"activity" | "rules">("activity");
  const countdown = useCountdown(market?.endTime);
  const refreshAfterTrade = () => {
    void refetch();
    void refetchPositions();
    if (market?.id != null) {
      void queryClient.invalidateQueries({ queryKey: ["range-markets-active"] });
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
          <p className="mb-2 text-[var(--muted)]">No {title} markets found.</p>
          <p className="text-xs text-[var(--muted)]">Markets are created daily at 00:00 ET.</p>
        </div>
      </div>
    );
  }

  const marketTypeClass = getRangeMarketAccent(marketType).pill;
  const marketTypeLabel = getRangeMarketLabel(marketType);
  const chronologicalMarkets = [...(allMarkets ?? [])].sort(
    (a, b) => getMarketDayTime(a) - getMarketDayTime(b)
  );
  const totalVolume = trades.reduce((sum, trade) => sum + (parseFloat(trade.collateral) || 0), 0);
  const activePositions = positions.filter((position) => parseFloat(position.balance) > 0);
  const selectedRangeData = selectedRange != null ? ranges[selectedRange] : null;
  const selectedPrice = selectedRange != null && total > 0
    ? (prices[selectedRange] ?? 0) / total
    : selectedRange != null
      ? 1 / Math.max(1, ranges.length)
      : 0;
  const canOpenMobileTrade = !market.resolved && Boolean(market.rangeCpmmAddress);
  const marketStats = [
    ["Volume", `$${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
    ["Liquidity", `$${parseFloat(market.totalLiquidity || "0").toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
    ["End Date", formatEasternShortDate(market.endTime) ?? market.date],
    ["Market ID", `#${market.id}`],
  ];

  const openMobileTrade = (rangeIndex: number) => {
    setSelectedRange(rangeIndex);
    setMobileTradeOpen(true);
  };

  return (
    <>
    <div className="fade-up relative mx-auto max-w-[1400px] pb-20 min-[901px]:pb-0">

      <div className="mb-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-[18px] md:px-6 md:py-[22px]">
        <div className="mb-[18px] flex flex-col items-start gap-3.5 md:mb-5 md:flex-row md:justify-between md:gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] ${marketTypeClass}`}>
                {marketTypeLabel}
              </span>
              <span className={`rounded px-2 py-[3px] text-[10px] font-bold ${
                market.resolved
                  ? "bg-yes/[0.08] text-yes"
                  : "bg-[var(--surface-hover)] text-[var(--muted-strong)]"
              }`}>
                {market.resolved ? "RESOLVED" : "ACTIVE"}
              </span>
            </div>
            <h1 className="max-w-[720px] text-base font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--foreground)] md:text-xl">{market.question}</h1>
            <p className="mt-2 max-w-[820px] text-xs leading-[1.6] text-[var(--muted)]">{description}</p>
          </div>

          {!market.resolved && (
            <div className="w-full shrink-0 md:w-auto">
              <div className="flex w-full items-end justify-between gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 py-2.5 md:w-auto md:justify-start md:border-0 md:bg-transparent md:p-0">
                {[{ v: countdown.h, l: "HRS" }, { v: countdown.m, l: "MINS" }, { v: countdown.s, l: "SECS" }].map(({ v, l }) => (
                  <div key={l} className="text-center">
                    <div className="mono text-[22px] font-medium leading-none md:text-[28px]">{v}</div>
                    <div className="mt-[3px] text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{l}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-right text-[10px] text-[var(--muted)] max-md:text-left">Resolves {market.date}</p>
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

        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-[18px] md:grid-cols-4">
          {marketStats.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-2.5 md:border-0 md:bg-transparent md:p-0">
              <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{label}</div>
              <div className="mono truncate text-sm text-[var(--foreground)]">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-[18px] border-t border-[var(--border-subtle)] pt-[18px]">
          <RangeActivityChart
            activity={activity}
            isLoading={isActivityLoading}
            label={marketType === "receipts" ? "Receipts Uploaded" : "Miners"}
          />
        </div>

        <div className="mt-[18px] border-t border-[var(--border-subtle)] pt-[18px]">
          <RangeProbabilityChart
            ranges={ranges}
            trades={trades}
            currentPrices={prices}
            colors={RANGE_COLORS}
            marketCreatedAt={market.createdAt}
          />
        </div>
      </div>

      {chronologicalMarkets.length > 1 && (
        <div className="card mb-4 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
            Previous Days
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {chronologicalMarkets.map((item) => {
              const isCurrent = item.id === market.id;
              const displayDate = formatEasternShortDate(item.endTime) ?? item.date;
              return (
                <Link
                  key={item.id}
                  href={`?marketId=${item.id}`}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs no-underline transition ${
                    isCurrent
                      ? "border-yes/40 bg-yes/10 text-yes"
                      : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <span className="block font-semibold">{displayDate}</span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-[0.06em]">
                    {item.resolved ? "Resolved" : item.status}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 min-[901px]:grid-cols-[1fr_360px]">
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 md:p-5">
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
          {activePositions.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3.5">
              <p className="mb-2.5 text-[11px] text-[var(--muted)]">Your Positions</p>
              <div className="flex flex-col gap-1.5">
                {activePositions.map((p) => {
                  const range = ranges[p.rangeIndex];
                  const rangeClass = RANGE_TEXT_CLASSES[p.rangeIndex % RANGE_TEXT_CLASSES.length];
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-[var(--surface-hover)] px-2.5 py-2">
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

        <div className="hidden min-[901px]:sticky min-[901px]:top-[70px] min-[901px]:block">
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

      <div className="mt-4">
        <div className="mb-3 flex gap-1">
          {[["activity", "Activity"], ["rules", "Rules"]].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value as "activity" | "rules")}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold ${
                tab === value
                  ? "border border-[var(--border)] bg-[var(--surface-hover)] text-[var(--foreground)]"
                  : "border border-transparent bg-transparent text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "activity" ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-[18px] md:px-5">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 border-b border-[var(--border-subtle)] pb-2.5 md:grid-cols-[120px_1fr_80px_80px_80px]">
              {["Outcome", "Trader", "Shares", "Amount", "Time"].map((heading) => (
                <span key={heading} className={`text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--muted)] ${heading === "Shares" || heading === "Time" ? "hidden md:inline" : ""}`}>
                  {heading}
                </span>
              ))}
            </div>
            {trades.slice(0, 8).map((trade, index, arr) => {
              const range = ranges[trade.rangeIndex];
              const rangeClass = RANGE_TEXT_CLASSES[trade.rangeIndex % RANGE_TEXT_CLASSES.length];
              return (
                <div key={trade.id} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 py-[11px] md:grid-cols-[120px_1fr_80px_80px_80px] ${index < arr.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}`}>
                  <span className={`w-fit rounded px-2 py-[3px] text-[9px] font-bold tracking-[0.04em] ${rangeClass}`}>
                    {trade.isBuy ? "BUY" : "SELL"} {range?.label ?? `Range ${trade.rangeIndex}`}
                  </span>
                  <span className="truncate font-mono text-[11px] text-[var(--muted)]">{trade.trader.slice(0, 6)}...{trade.trader.slice(-4)}</span>
                  <span className="hidden font-mono text-[11px] md:inline">{Number(trade.shares).toFixed(1)}</span>
                  <span className="font-mono text-[11px]">${Number(trade.collateral).toFixed(2)}</span>
                  <span className="hidden text-[10px] text-[var(--muted)] md:inline">{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              );
            })}
            {trades.length === 0 && <p className="mt-3 text-xs text-[var(--muted)]">No trades yet</p>}
          </div>
        ) : (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
            <div className="mb-5 text-[13px] leading-[1.75] text-[var(--foreground)]">{description}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[["Opened", new Date(market.createdAt).toLocaleString()], ["End Date", new Date(market.endTime).toLocaleString()], ["Market Type", marketTypeLabel], ["Status", market.status]].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3.5 py-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">{label}</div>
                  <div className="font-mono text-xs">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

      {canOpenMobileTrade && ranges.length > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[50] grid grid-flow-cols grid-cols-4 gap-2 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.28)] min-[901px]:hidden">
          {ranges.map((range, index) => {
            const displayPrice = total > 0 ? (prices[index] ?? 0) / total : 1 / ranges.length;
            const selected = selectedRange === index;
            return (
              <button
                key={range.index}
                type="button"
                onClick={() => openMobileTrade(index)}
                className={`shrink-0 cursor-pointer rounded-xl border px-3.5 py-2.5 text-left ${
                  selected
                    ? "border-yes/40 bg-yes/10 text-yes"
                    : "border-[var(--border-subtle)] bg-[var(--surface-hover)]"
                }`}
              >
                <span className="block max-w-[120px] truncate text-[11px] font-semibold text-[var(--foreground)]">{range.label}</span>
                <span className={`mt-0.5 block font-mono text-sm font-bold ${RANGE_TEXT_CLASSES[index % RANGE_TEXT_CLASSES.length]}`}>
                  {(displayPrice * 100).toFixed(1)}¢
                </span>
              </button>
            );
          })}
        </div>
      )}

      {canOpenMobileTrade && (
        <Drawer open={mobileTradeOpen} onOpenChange={setMobileTradeOpen}>
          <DrawerContent className="min-[901px]:hidden">
            <DrawerHeader>
              
             
            </DrawerHeader>
            <div className="overflow-y-auto">
              <TradePanelRange
                market={market}
                selectedRangeIndex={selectedRange}
                prices={prices}
                positions={positions}
                onSuccess={refreshAfterTrade}
                onPricesUpdate={setLivePrices}
              />
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
