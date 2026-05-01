"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolio, usePortfolioSummary } from "@/hooks/usePortfolio";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { VaultModal } from "@/components/VaultModal";
import { VaultTransactionHistory } from "@/components/VaultTransactionHistory";
import { MarketFactoryABI } from "@nam-prediction/shared";
import { MARKET_FACTORY_ADDRESS } from "@/lib/contracts";
import { toast } from "sonner";
import type { PositionWithMarket } from "@/hooks/usePortfolio";
import { Wallet, TrendingUp, Trophy, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

const DUST = 1e-6;

function isRangePosition(
  pos: PositionWithMarket
): pos is Extract<PositionWithMarket, { positionType: "range" }> {
  return pos.positionType === "range";
}

function hasPortfolioShares(pos: PositionWithMarket) {
  if (isRangePosition(pos)) return Number(pos.rangeBalance || "0") >= DUST;
  return Number(pos.yesBalance || "0") >= DUST || Number(pos.noBalance || "0") >= DUST;
}

function getPortfolioValue(pos: PositionWithMarket) {
  if (isRangePosition(pos)) return Number(pos.rangeCurrentValue || "0");
  return Number(pos.yesCurrentValue || "0") + Number(pos.noCurrentValue || "0");
}

function getPortfolioPnl(pos: PositionWithMarket) {
  return Number(pos.pnl || "0");
}

function getTotalCost(pos: PositionWithMarket) {
  return Number(pos.totalCost || "0");
}

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const { login } = usePrivy();
  const { data: positions, isLoading } = usePortfolio();
  const { data: portfolioSummary } = usePortfolioSummary();
  const { usdcBalance, isLoading: isBalanceLoading } = useVaultBalance();
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultTab, setVaultTab] = useState<"deposit" | "withdraw">("deposit");

  if (!isConnected) {
    return (
      <div className="card fade-up" style={{ textAlign: "center", padding: "80px 20px" }}>
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)", marginBottom: 8 }}>
          Portfolio
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
          Connect your wallet to view positions
        </p>
        <button
          onClick={login}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            background: "#01d243",
            color: "#000",
            border: "none",
            cursor: "pointer",
          }}
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  const activePositions = positions?.filter((p) => !p.resolved) ?? [];
  const resolvedPositions = positions?.filter((p) => p.resolved) ?? [];
  const activeWithShares = activePositions.filter(hasPortfolioShares);

  const totalActiveValue = activeWithShares.reduce(
    (s, p) => s + getPortfolioValue(p),
    0
  );
  const totalPnl = activeWithShares.reduce((s, p) => s + getPortfolioPnl(p), 0);
  const realisedPnl = Number(portfolioSummary?.realisedPnl || "0");
  const summaryResolvedCount = portfolioSummary?.resolvedCount ?? 0;
  const winRate = Number(portfolioSummary?.winRate || "0");
  const resolvedCost = Number(portfolioSummary?.resolvedCost || "0");
  const resolvedValue = Number(portfolioSummary?.resolvedValue || "0");
  const resolvedPnl = resolvedValue - resolvedCost;

  return (<>
  <VaultModal
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        initialTab={vaultTab}
      />
      <div className="fade-up">
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          color: "var(--foreground)",
          marginBottom: 20,
        }}
      >
        Portfolio
      </h1>

      {/* Summary row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted)",
              }}
            >
              Active Value
            </div>
            <Wallet className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
          </div>
          <div className="mono" style={{ fontSize: 21, color: "var(--foreground)" }}>
            ${totalActiveValue.toFixed(2)}
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted)",
              }}
            >
              Unrealised P&L
            </div>
            <TrendingUp className="w-3.5 h-3.5" style={{ color: totalPnl >= 0 ? "#01d243" : "#f0324c" }} />
          </div>
          <div
            className="mono"
            style={{ fontSize: 21, color: totalPnl >= 0 ? "#01d243" : "#f0324c" }}
          >
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted)",
              }}
            >
              Realised P&L
            </div>
            <TrendingUp className="w-3.5 h-3.5" style={{ color: realisedPnl >= 0 ? "#01d243" : "#f0324c" }} />
          </div>
          <div
            className="mono"
            style={{ fontSize: 21, color: realisedPnl >= 0 ? "#01d243" : "#f0324c" }}
          >
            {realisedPnl >= 0 ? "+" : ""}${realisedPnl.toFixed(2)}
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--muted)",
              }}
            >
              Win Rate
            </div>
            <Trophy className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
          </div>
          <div className="mono" style={{ fontSize: 21, color: "var(--foreground)" }}>
            {summaryResolvedCount > 0 ? `${Math.round(winRate)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Vault card */}
      <div
        className="card"
        style={{
          padding: 18,
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--muted)",
              marginBottom: 4,
            }}
          >
            Vault Balance
          </div>
          {isBalanceLoading ? (
            <div style={{ height: 28, width: 80, borderRadius: 6, background: "var(--surface-hover)", marginTop: 2 }} />
          ) : (
            <div className="mono" style={{ fontSize: 21, color: "#01d243" }}>
              ${parseFloat(usdcBalance).toFixed(2)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setVaultTab("deposit");
              setVaultOpen(true);
            }}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "#01d243",
              color: "#000",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit
          </button>
          <button
            onClick={() => {
              setVaultTab("withdraw");
              setVaultOpen(true);
            }}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "var(--surface-hover)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
          </button>
        </div>
      </div>

      {/* Positions table */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
              color: "var(--muted)",
            }}
          >
            Active Positions
          </h2>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {activeWithShares.length} positions
          </span>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="card-2" style={{ height: 52 }} />
            ))}
          </div>
        )}

        {!isLoading && activeWithShares.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <p style={{ fontSize: 13, color: "var(--foreground)", marginBottom: 4 }}>
              No active positions
            </p>
            <p style={{ fontSize: 11, color: "var(--muted)" }}>
              Start trading to build your portfolio
            </p>
          </div>
        )}

        {activeWithShares.length > 0 && (
          <div>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 80px",
                gap: 8,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border-subtle)",
                marginBottom: 4,
              }}
            >
              {["Market", "Side", "Shares", "Avg Price", "Cost", "Value", "P&L"].map(
                (h) => (
                  <div
                    key={h}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--muted)",
                    }}
                  >
                    {h}
                  </div>
                )
              )}
            </div>
            {activeWithShares.map((pos) => (
              <PositionTableRow key={`${pos.positionType ?? "binary"}-${pos.id}`} pos={pos} address={address} />
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {resolvedPositions.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--muted)",
              }}
            >
              Resolved Positions
            </h2>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Cost ${resolvedCost.toFixed(2)} - P&L{" "}
              <span style={{ color: resolvedPnl >= 0 ? "#01d243" : "#f0324c" }}>
                {resolvedPnl >= 0 ? "+" : ""}${resolvedPnl.toFixed(2)}
              </span>
            </span>
          </div>
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 80px",
                gap: 8,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border-subtle)",
                marginBottom: 4,
              }}
            >
              {["Market", "Side", "Shares", "Result", "Cost", "P&L", "Action"].map(
                (h) => (
                  <div
                    key={h}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--muted)",
                    }}
                  >
                    {h}
                  </div>
                )
              )}
            </div>
            {resolvedPositions.map((pos) => (
              <PositionTableRow
                key={`${pos.positionType ?? "binary"}-${pos.id}`}
                pos={pos}
                address={address}
                resolved
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <VaultTransactionHistory />
      </div>

      
    </div>
  </>
    
  );
}

/* ---- Position table row ---- */

function PositionTableRow({
  pos,
  address,
  resolved,
}: {
  pos: PositionWithMarket;
  address: `0x${string}` | undefined;
  resolved?: boolean;
}) {
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | null>(null);
  const { writeContract, data: txHash } = useWriteContract({
    mutation: {
      onError: (err: any) => {
        const msg = err?.shortMessage || err?.message || "Redeem failed";
        const isRejection =
          /user (rejected|denied)|rejected the request/i.test(msg);
        const display = isRejection ? "Redeem cancelled" : msg;
        if (toastIdRef.current) {
          toast.error(display, { id: toastIdRef.current });
          toastIdRef.current = null;
        } else toast.error(display);
      },
    },
  });
  const { isLoading: redeemLoading, isSuccess } =
    useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!redeemLoading || !toastIdRef.current) return;
    toast.loading("Redeeming…", { id: toastIdRef.current });
  }, [redeemLoading]);

  useEffect(() => {
    if (!isSuccess) return;
    if (toastIdRef.current) {
      toast.success("Redeemed. Payout added to your vault.", {
        id: toastIdRef.current,
      });
      toastIdRef.current = null;
    } else toast.success("Redeemed. Payout added to your vault.");
    const kick = () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio", address] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-summary", address] });
      queryClient.invalidateQueries({ queryKey: ["vault-balance", address] });
      queryClient.invalidateQueries({ queryKey: ["vault-transactions", address] });
    };
    kick();
    const t1 = setTimeout(kick, 1500);
    const t2 = setTimeout(kick, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSuccess, address, queryClient]);

  const handleRedeem = () => {
    if (isRangePosition(pos)) return;
    if (!MARKET_FACTORY_ADDRESS) return;
    const id = `redeem-${pos.onChainId}-${Date.now()}`;
    toastIdRef.current = id;
    toast.loading("Confirm redeem in your wallet…", { id });
    writeContract({
      address: MARKET_FACTORY_ADDRESS,
      abi: MarketFactoryABI,
      functionName: "redeem",
      args: [BigInt(pos.onChainId)],
    });
  };

  if (isRangePosition(pos)) {
    const balance = Number(pos.rangeBalance || "0");
    const currentValue = Number(pos.rangeCurrentValue || "0");
    const pnl = Number(pos.rangePnl || "0");
    const marketHref =
      pos.marketType === "receipts" || pos.marketType === "nam-distribution"
        ? `/markets/${pos.marketType}`
        : "/portfolio";
    const isWinningRange =
      pos.resolved &&
      pos.winningRangeIndex != null &&
      pos.rangeIndex === pos.winningRangeIndex;
    const winnerLabel =
      pos.winningRangeIndex != null
        ? pos.ranges.find((range) => range.index === pos.winningRangeIndex)?.label ??
          `Range ${pos.winningRangeIndex}`
        : "Pending";

    return (
      <Link href={marketHref}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: resolved
              ? "2fr 1fr 1fr 1fr 1fr 1fr 80px"
              : "2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 80px",
            gap: 8,
            padding: "10px 0",
            borderBottom: "1px solid var(--border-subtle)",
            cursor: "pointer",
            transition: "background 0.12s",
            alignItems: "center",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pos.question}
          </div>
          <div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 4,
                background: "rgba(108,122,255,0.10)",
                color: "#6c7aff",
              }}
            >
              {pos.rangeLabel}
            </span>
          </div>
          <div
            className="mono"
            style={{ fontSize: 12, color: "var(--foreground)" }}
          >
            {balance.toFixed(2)}
          </div>
          {!resolved ? (
            <>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--muted)" }}
              >
                {(pos.rangeAvgPrice * 100).toFixed(1)}¢
              </div>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--foreground)" }}
              >
                ${getTotalCost(pos).toFixed(2)}
              </div>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--foreground)" }}
              >
                ${currentValue.toFixed(2)}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: pnl >= 0 ? "#01d243" : "#f0324c",
                }}
              >
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isWinningRange ? "#01d243" : "#f0324c",
                }}
              >
                {winnerLabel} won
              </div>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--foreground)" }}
              >
                ${getTotalCost(pos).toFixed(2)}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: pnl >= 0 ? "#01d243" : "#f0324c",
                }}
              >
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
              </div>
              <div>
                <span
                  style={{
                    fontSize: 10,
                    color: isWinningRange ? "#01d243" : "#f0324c",
                  }}
                >
                  {isWinningRange ? "Won" : "Lost"}
                </span>
              </div>
            </>
          )}
        </div>
      </Link>
    );
  }

  const yesBal = Number(pos.yesBalance || "0");
  const noBal = Number(pos.noBalance || "0");
  const hasYes = yesBal >= DUST;
  const hasNo = noBal >= DUST;

  const legs: {
    side: "YES" | "NO";
    bal: number;
    avgPrice: number;
    cost: number;
    value: number;
    pnl: number;
    redeemed: boolean;
  }[] = [];
  if (hasYes)
    legs.push({
      side: "YES",
      bal: yesBal,
      avgPrice: pos.yesAvgPrice,
      cost: Number(pos.yesCostBasis || "0"),
      value: Number(pos.yesCurrentValue || "0"),
      pnl: Number(pos.yesPnl || "0"),
      redeemed: pos.redeemed && pos.result === 1,
    });
  if (hasNo)
    legs.push({
      side: "NO",
      bal: noBal,
      avgPrice: pos.noAvgPrice,
      cost: Number(pos.noCostBasis || "0"),
      value: Number(pos.noCurrentValue || "0"),
      pnl: Number(pos.noPnl || "0"),
      redeemed: pos.redeemed && pos.result === 2,
    });

  const isWin = (side: "YES" | "NO") =>
    pos.resolved &&
    ((side === "YES" && pos.result === 1) ||
      (side === "NO" && pos.result === 2));

  return (
    <>
      {legs.map((leg) => (
        <Link key={`${pos.id}-${leg.side}`} href={`/market/${pos.marketId}`}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: resolved
                ? "2fr 1fr 1fr 1fr 1fr 1fr 80px"
                : "2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 80px",
              gap: 8,
              padding: "10px 0",
              borderBottom: "1px solid var(--border-subtle)",
              cursor: "pointer",
              transition: "background 0.12s",
              alignItems: "center",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--surface-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <div
              style={{
                fontSize: 12,
                color: "var(--foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pos.question}
            </div>
            <div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background:
                    leg.side === "YES"
                      ? "rgba(1,210,67,0.10)"
                      : "rgba(240,50,76,0.10)",
                  color: leg.side === "YES" ? "#01d243" : "#f0324c",
                }}
              >
                {leg.side}
              </span>
            </div>
            <div
              className="mono"
              style={{ fontSize: 12, color: "var(--foreground)" }}
            >
              {leg.bal.toFixed(2)}
            </div>
            {!resolved ? (
              <>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--muted)" }}
                >
                  {(leg.avgPrice * 100).toFixed(1)}¢
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--foreground)" }}
                >
                  ${leg.cost.toFixed(2)}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--foreground)" }}
                >
                  ${leg.value.toFixed(2)}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: leg.pnl >= 0 ? "#01d243" : "#f0324c",
                  }}
                >
                  {leg.pnl >= 0 ? "+" : ""}${leg.pnl.toFixed(2)}
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color:
                      pos.result === 1 ? "#01d243" : "#f0324c",
                  }}
                >
                  {pos.result === 1 ? "YES" : "NO"} won
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--foreground)" }}
                >
                  ${leg.cost.toFixed(2)}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: leg.pnl >= 0 ? "#01d243" : "#f0324c",
                  }}
                >
                  {leg.pnl >= 0 ? "+" : ""}${leg.pnl.toFixed(2)}
                </div>
                <div>
                  {isWin(leg.side) && !leg.redeemed && leg.bal > DUST ? (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRedeem();
                      }}
                      disabled={redeemLoading}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "#01d243",
                        color: "#000",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {redeemLoading ? "…" : "Redeem"}
                    </button>
                  ) : isWin(leg.side) ? (
                    <span style={{ fontSize: 10, color: "#01d243" }}>
                      Redeemed
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: "#f0324c" }}>
                      Lost
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </Link>
      ))}
    </>
  );
}
