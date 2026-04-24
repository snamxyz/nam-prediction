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
import { AlertTriangle } from "lucide-react";

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
  const C = isYes ? "#01d243" : "#f0324c";

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
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e4e5eb" }}>Trade</h3>
          {isAuthenticated && (
            <span className="mono" style={{ fontSize: 11, color: "#4c4e68" }}>
              Balance: <span style={{ color: "#01d243" }}>${parseFloat(usdcBalance).toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 20px 20px" }}>
        {/* Buy / Sell mode toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
          {(["BUY", "SELL"] as const).map((m) => {
            const active = mode === m;
            const mc = m === "BUY" ? "#01d243" : "#f0324c";
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(""); setEstimate(null); setError(null); }}
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

        {/* Yes / No toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 18 }}>
          {(["YES", "NO"] as const).map((s) => {
            const active = side === s;
            const sc = s === "YES" ? "#01d243" : "#f0324c";
            const sidePrice = s === "YES" ? yesPrice : noPrice;
            return (
              <button
                key={s}
                onClick={() => setSide(s)}
                style={{
                  padding: "10px 0",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${active ? sc + "4d" : "rgba(255,255,255,0.04)"}`,
                  background: active ? sc + "22" : "#111320",
                  color: active ? sc : "#4c4e68",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {s === "YES" ? "Yes" : "No"} {formatCents(sidePrice)}
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <p style={{ fontSize: 11, color: "#4c4e68" }}>
            {mode === "BUY" ? "Amount (USDC)" : "Shares to Sell"}
          </p>
          {mode === "SELL" && isAuthenticated && (
            <p style={{ fontSize: 11, color: "#4c4e68" }}>
              Owned:{" "}
              <span style={{ color: ownedShares > 0 ? C : "#4c4e68", fontWeight: 600 }}>
                {formatShares(ownedShares)} {side}
              </span>
            </p>
          )}
        </div>
        <div style={{ position: "relative", marginBottom: 10 }}>
          {mode === "BUY" && (
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#4c4e68" }}>$</span>
          )}
          <input
            type="number"
            min="0"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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

        {/* Quick sell percentages */}
        {mode === "SELL" && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {SELL_PERCENTS.map((p) => {
              const disabled = ownedShares <= 0;
              const label = p === 100 ? "MAX" : `${p}%`;
              return (
                <button
                  key={p}
                  onClick={() => setSellPercent(p)}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    borderRadius: 6,
                    fontSize: 11,
                    background: "#111320",
                    color: disabled ? "rgba(76,78,104,0.50)" : "#4c4e68",
                    cursor: disabled ? "not-allowed" : "pointer",
                    border: "1px solid rgba(255,255,255,0.04)",
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.background = "#1a1c2a";
                    e.currentTarget.style.color = "#e4e5eb";
                  }}
                  onMouseLeave={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.background = "#111320";
                    e.currentTarget.style.color = "#4c4e68";
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
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setAmount((s) => String((parseFloat(s) || 0) + q))}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 6,
                  fontSize: 11,
                  background: "#111320",
                  color: "#4c4e68",
                  border: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1a1c2a";
                  e.currentTarget.style.color = "#e4e5eb";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#111320";
                  e.currentTarget.style.color = "#4c4e68";
                }}
              >
                +${q}
              </button>
            ))}
            <button
              onClick={() => setAmount(usdcBalance)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                fontSize: 11,
                background: "#111320",
                color: "#4c4e68",
                border: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#1a1c2a";
                e.currentTarget.style.color = "#e4e5eb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#111320";
                e.currentTarget.style.color = "#4c4e68";
              }}
            >
              Max
            </button>
          </div>
        )}

        {/* Slippage tolerance */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <p style={{ fontSize: 11, color: "#4c4e68" }}>Max slippage</p>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {SLIPPAGE_PRESETS.map((s) => {
              const active = slippagePct === s;
              return (
                <button
                  key={s}
                  onClick={() => setSlippagePct(s)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    border: `1px solid ${active ? "rgba(1,210,67,0.30)" : "rgba(255,255,255,0.04)"}`,
                    background: active ? "rgba(1,210,67,0.12)" : "#111320",
                    color: active ? "#01d243" : "#4c4e68",
                    cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {s}%
                </button>
              );
            })}
          </div>
        </div>

        {/* Return breakdown */}
        <div style={{ borderRadius: 10, padding: 14, marginBottom: 18, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
            <span style={{ color: "#4c4e68" }}>Avg price</span>
            <span className="mono" style={{ color: "#e4e5eb" }}>
              {estimate?.avgPrice ? formatCents(avgPriceNum) : formatCents(price)}
            </span>
          </div>

          {num > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
              <span style={{ color: "#4c4e68" }}>Price impact</span>
              <span className="mono" style={{ color: highImpact ? "#f0324c" : "#e4e5eb" }}>
                {priceImpactPct.toFixed(2)}%
              </span>
            </div>
          )}

          {mode === "BUY" ? (
            <>
              {num > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                    <span style={{ color: "#4c4e68" }}>Trade amount</span>
                    <span className="mono" style={{ color: "#e4e5eb" }}>
                      ${num.toFixed(4)}
                    </span>
                  </div>
                  {protocolFeeNum > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                        <span style={{ color: "#4c4e68" }}>
                          Protocol fee{protocolFeePctLabel ? ` (${protocolFeePctLabel})` : ""}
                        </span>
                        <span className="mono" style={{ color: "#ffa500" }}>
                          −${protocolFeeNum.toFixed(4)}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                        <span style={{ color: "#4c4e68" }}>Net trade amount</span>
                        <span className="mono" style={{ color: "#e4e5eb" }}>
                          ${netAmountNum.toFixed(4)}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: "#4c4e68" }}>Shares</span>
                <span className="mono" style={{ color: "#e4e5eb" }}>
                  {num > 0 ? estimatedShares.toFixed(4) : "—"}
                </span>
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: "#4c4e68" }}>Potential return</span>
                <span className="mono" style={{ color: num > 0 ? C : "#4c4e68", fontWeight: num > 0 ? 600 : 400 }}>
                  {num > 0 ? `$${potentialPayout.toFixed(2)} (+${pct.toFixed(1)}%)` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#4c4e68" }}>Payout if {side} wins</span>
                <span className="mono" style={{ color: "rgba(228,229,235,0.80)" }}>
                  {num > 0 ? `$${potentialPayout.toFixed(2)}` : "—"}
                </span>
              </div>
            </>
          ) : (
            <>
              {num > 0 && grossAmountNum > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                    <span style={{ color: "#4c4e68" }}>Gross proceeds</span>
                    <span className="mono" style={{ color: "#e4e5eb" }}>
                      ${grossAmountNum.toFixed(4)}
                    </span>
                  </div>
                  {protocolFeeNum > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                      <span style={{ color: "#4c4e68" }}>
                        Protocol fee{protocolFeePctLabel ? ` (${protocolFeePctLabel})` : ""}
                      </span>
                      <span className="mono" style={{ color: "#ffa500" }}>
                        −${protocolFeeNum.toFixed(4)}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#4c4e68" }}>USDC received</span>
                <span className="mono" style={{ color: num > 0 ? "#01d243" : "#4c4e68", fontWeight: num > 0 ? 600 : 400 }}>
                  {num > 0 ? `$${estimatedUsdc.toFixed(4)}` : "—"}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Slippage warning */}
        {num > 0 && highImpact && (
          <p
            style={{
              fontSize: 11,
              marginBottom: 10,
              padding: "8px 12px",
              borderRadius: 8,
              color: "#ffa500",
              background: "rgba(255,165,0,0.08)",
              border: "1px solid rgba(255,165,0,0.20)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              High price impact ({priceImpactPct.toFixed(2)}%). Consider a smaller trade size.
            </span>
          </p>
        )}

        {/* Error */}
        {error && (
          <p
            style={{
              fontSize: 11,
              marginBottom: 10,
              padding: "8px 12px",
              borderRadius: 8,
              color: "#f0324c",
              background: "rgba(240,50,76,0.08)",
            }}
          >
            {error}
          </p>
        )}

        {/* Trade button */}
        {!isAuthenticated ? (
          <button
            onClick={login}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              background: "#01d243",
              color: "#000",
              cursor: "pointer",
              border: "none",
            }}
          >
            Connect to Trade
          </button>
        ) : (
          <button
            onClick={handleTrade}
            disabled={!isConnected || num <= 0 || isLoading || !wallets.length}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              transition: "all 0.12s",
              ...(isConnected && num > 0 && !isLoading && wallets.length > 0
                ? { background: C, color: isYes ? "#000" : "#fff", cursor: "pointer" }
                : { background: "#111320", color: "#4c4e68", cursor: "not-allowed" }),
            }}
          >
            {isLoading
              ? "Processing…"
              : num > 0
              ? `${mode === "BUY" ? "Buy" : "Sell"} ${side} · ${mode === "BUY" ? `$${num.toFixed(2)}` : `${num} shares`}`
              : "Enter an amount"}
          </button>
        )}
        <p style={{ textAlign: "center", fontSize: 9, marginTop: 10, color: "rgba(76,78,104,0.50)" }}>
          Each trade requires a wallet signature. By trading, you agree to the Terms of Use.
        </p>

        {/* Current position summary */}
        {isAuthenticated && (yesShares >= DUST || noShares >= DUST) && (
          <div style={{ marginTop: 14, borderRadius: 10, padding: 14, background: "#111320", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, color: "#4c4e68" }}>Your Position</p>
            {yesShares >= DUST && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(1,210,67,0.12)", color: "#01d243" }}>YES</span>
                  <span className="mono" style={{ color: "#e4e5eb" }}>{yesShares.toFixed(4)} shares</span>
                  <span className="mono" style={{ color: "#4c4e68" }}>@ {(yesAvgDisplay * 100).toFixed(1)}¢</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="mono" style={{ color: "#e4e5eb" }}>${Number(position?.yesCurrentValue ?? 0).toFixed(2)}</span>
                  <span className="mono" style={{ color: Number(position?.yesPnl ?? 0) >= 0 ? "#01d243" : "#f0324c" }}>
                    {Number(position?.yesPnl ?? 0) >= 0 ? "+" : ""}${Number(position?.yesPnl ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {noShares >= DUST && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "rgba(240,50,76,0.12)", color: "#f0324c" }}>NO</span>
                  <span className="mono" style={{ color: "#e4e5eb" }}>{noShares.toFixed(4)} shares</span>
                  <span className="mono" style={{ color: "#4c4e68" }}>@ {(noAvgDisplay * 100).toFixed(1)}¢</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="mono" style={{ color: "#e4e5eb" }}>${Number(position?.noCurrentValue ?? 0).toFixed(2)}</span>
                  <span className="mono" style={{ color: Number(position?.noPnl ?? 0) >= 0 ? "#01d243" : "#f0324c" }}>
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
