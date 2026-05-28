"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useAdminUser, useAdminUserHoldings } from "@/hooks/useAdmin";
import {
  usePortfolioForAddress,
  usePortfolioSummaryForAddress,
  type PositionWithMarket,
} from "@/hooks/usePortfolio";
import { useVaultUserBalances } from "@/hooks/useVaultUserBalances";
import { useVaultTransactions, type VaultTransaction } from "@/hooks/useVaultTransactions";

const DUST = 1e-6;

function isRangePosition(
  pos: PositionWithMarket
): pos is Extract<PositionWithMarket, { positionType: "range" }> {
  return pos.positionType === "range";
}

function truncateAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function fmtUsd(value: string | number | undefined) {
  const n = Number(value ?? 0);
  return `$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function getUserName(user: { displayName: string | null; loginMethod: string | null; walletAddress: string | null }) {
  if (user.displayName) return user.displayName;
  if (user.loginMethod && user.loginMethod !== "wallet") return user.loginMethod;
  if (user.walletAddress) return truncateAddress(user.walletAddress);
  return "Unknown user";
}

function hasPortfolioShares(pos: PositionWithMarket) {
  if (isRangePosition(pos)) return Number(pos.rangeBalance || "0") >= DUST;
  return Number(pos.yesBalance || "0") >= DUST || Number(pos.noBalance || "0") >= DUST;
}

function positionHref(pos: PositionWithMarket) {
  if (isRangePosition(pos)) {
    return pos.marketType === "receipts" || pos.marketType === "participants"
      ? `/markets/${pos.marketType}?marketId=${pos.marketId}`
      : "#";
  }

  return `/market/${pos.marketId}`;
}

function txLabel(tx: VaultTransaction) {
  if (tx.type === "withdraw") return "Withdrawal";
  if (tx.type === "redemption") return "Redemption";
  return tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
}

function txDetail(tx: VaultTransaction) {
  if (tx.question) return `${tx.side ? `${tx.side} - ` : ""}${tx.question}`;
  return tx.source ? tx.source.charAt(0).toUpperCase() + tx.source.slice(1) : "Vault";
}

function TransactionTable({
  transactions,
  isLoading,
}: {
  transactions: VaultTransaction[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Wallet Transactions</h2>
        <span className="text-xs text-[var(--muted)]">{transactions.length} recent</span>
      </div>
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[120px_minmax(220px,1fr)_90px_130px_40px] gap-3 border-b border-[var(--border-subtle)] pb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>Type</span>
          <span>Detail</span>
          <span>Amount</span>
          <span>Time</span>
          <span>Tx</span>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">Loading transactions...</p>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">No wallet transactions</p>
        ) : (
          transactions.map((tx) => {
            const positive = tx.type === "deposit" || tx.type === "sell" || tx.type === "redemption";
            return (
              <div
                key={tx.id}
                className="grid grid-cols-[120px_minmax(220px,1fr)_90px_130px_40px] gap-3 border-b border-[var(--border-subtle)] py-3 text-xs"
              >
                <span className="text-[var(--foreground)]">{txLabel(tx)}</span>
                <span className="truncate text-[var(--muted)]">{txDetail(tx)}</span>
                <span className={`font-mono ${positive ? "text-yes" : "text-no"}`}>
                  {positive ? "+" : "-"}{fmtUsd(tx.amount)}
                </span>
                <span className="text-[var(--muted)]">{new Date(tx.timestamp).toLocaleString()}</span>
                <a
                  href={`https://basescan.org/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function positionRowCount(pos: PositionWithMarket) {
  if (isRangePosition(pos)) return 1;
  return Number(pos.yesBalance || "0") >= DUST && Number(pos.noBalance || "0") >= DUST ? 2 : 1;
}

function PositionRow({ pos, resolved }: { pos: PositionWithMarket; resolved?: boolean }) {
  const href = positionHref(pos);

  if (isRangePosition(pos)) {
    const pnl = Number(pos.rangePnl || "0");
    const isWinningRange =
      pos.resolved &&
      pos.winningRangeIndex != null &&
      pos.rangeIndex === pos.winningRangeIndex;

    return (
      <Link
        href={href}
        className="grid grid-cols-[minmax(180px,2fr)_110px_90px_90px_90px] gap-3 border-b border-[var(--border-subtle)] py-3 text-xs no-underline"
      >
        <span className="truncate font-medium text-[var(--foreground)]">{pos.question}</span>
        <span className="text-[var(--muted)]">{pos.rangeLabel}</span>
        <span className="font-mono text-[var(--foreground)]">{Number(pos.rangeBalance || 0).toFixed(2)}</span>
        <span className="font-mono text-[var(--foreground)]">{fmtUsd(pos.totalCost)}</span>
        <span className={`font-mono ${pnl >= 0 ? "text-yes" : "text-no"}`}>
          {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}
          {resolved && <span className="ml-1 text-[var(--muted)]">{isWinningRange ? "Won" : "Lost"}</span>}
        </span>
      </Link>
    );
  }

  const yesBalance = Number(pos.yesBalance || "0");
  const noBalance = Number(pos.noBalance || "0");
  const legs = [
    yesBalance >= DUST
      ? {
          side: "YES",
          shares: yesBalance,
          cost: Number(pos.yesCostBasis || "0"),
          pnl: Number(pos.yesPnl || "0"),
        }
      : null,
    noBalance >= DUST
      ? {
          side: "NO",
          shares: noBalance,
          cost: Number(pos.noCostBasis || "0"),
          pnl: Number(pos.noPnl || "0"),
        }
      : null,
  ].filter((leg) => leg !== null);

  return (
    <>
      {legs.map((leg) => (
        <Link
          key={`${pos.id}-${leg.side}`}
          href={href}
          className="grid grid-cols-[minmax(180px,2fr)_110px_90px_90px_90px] gap-3 border-b border-[var(--border-subtle)] py-3 text-xs no-underline"
        >
          <span className="truncate font-medium text-[var(--foreground)]">{pos.question}</span>
          <span className="text-[var(--muted)]">{leg.side}</span>
          <span className="font-mono text-[var(--foreground)]">{leg.shares.toFixed(2)}</span>
          <span className="font-mono text-[var(--foreground)]">{fmtUsd(leg.cost)}</span>
          <span className={`font-mono ${leg.pnl >= 0 ? "text-yes" : "text-no"}`}>
            {leg.pnl >= 0 ? "+" : ""}{fmtUsd(leg.pnl)}
          </span>
        </Link>
      ))}
    </>
  );
}

function PositionTable({
  title,
  positions,
  resolved,
}: {
  title: string;
  positions: PositionWithMarket[];
  resolved?: boolean;
}) {
  const rowCount = positions.reduce((sum, position) => sum + positionRowCount(position), 0);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        <span className="text-xs text-[var(--muted)]">{rowCount} positions</span>
      </div>
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(180px,2fr)_110px_90px_90px_90px] gap-3 border-b border-[var(--border-subtle)] pb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>Market</span>
          <span>Side</span>
          <span>Shares</span>
          <span>Cost</span>
          <span>P&amp;L</span>
        </div>
        {positions.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">No {title.toLowerCase()}</p>
        ) : (
          positions.map((pos) => (
            <PositionRow key={`${pos.positionType ?? "binary"}-${pos.id}`} pos={pos} resolved={resolved} />
          ))
        )}
      </div>
    </div>
  );
}

export default function AdminUserProfilePage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const { data: detail, isLoading: isUserLoading } = useAdminUser(id);
  const { data: adminHoldings } = useAdminUserHoldings(id);
  const walletAddress = detail?.user.walletAddress ?? undefined;
  const vaultWalletAddresses = useMemo(
    () => (walletAddress ? [walletAddress as `0x${string}`] : []),
    [walletAddress]
  );
  const { data: positions = [], isLoading: isPortfolioLoading } = usePortfolioForAddress(walletAddress);
  const { data: summary } = usePortfolioSummaryForAddress(walletAddress);
  const { data: vaultBalances, isLoading: isVaultBalanceLoading } = useVaultUserBalances(vaultWalletAddresses);
  const { transactions, isLoading: isTransactionsLoading } = useVaultTransactions(walletAddress);
  const vaultBalance = walletAddress
    ? vaultBalances?.balances[walletAddress.toLowerCase()]
    : undefined;

  const activePositions = useMemo(
    () => positions.filter((position) => !position.resolved && hasPortfolioShares(position)),
    [positions]
  );
  const resolvedPositions = useMemo(
    () => positions.filter((position) => position.resolved),
    [positions]
  );

  const activeValue = activePositions.reduce((sum, pos) => {
    if (isRangePosition(pos)) return sum + Number(pos.rangeCurrentValue || "0");
    return sum + Number(pos.yesCurrentValue || "0") + Number(pos.noCurrentValue || "0");
  }, 0);
  const unrealisedPnl = activePositions.reduce((sum, pos) => sum + Number(pos.pnl || "0"), 0);
  const vaultFlow = adminHoldings?.vault;
  const snapshotSub = adminHoldings?.snapshotAt
    ? `${adminHoldings.snapshotSource === "redis" ? "Redis" : "DB"} snapshot ${new Date(
        adminHoldings.snapshotAt
      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${adminHoldings.stale ? " · rebuilt on demand" : ""}`
    : undefined;

  if (isUserLoading) {
    return <div className="glass-card p-6 text-sm text-[var(--muted)]">Loading user profile...</div>;
  }

  if (!detail?.user) {
    return <div className="glass-card p-6 text-sm text-[var(--muted)]">User not found.</div>;
  }

  const userName = getUserName(detail.user);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin/users" className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--muted)] no-underline hover:text-[var(--foreground)]">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to users
          </Link>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{userName}</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">User portfolio and vault holdings.</p>
        </div>
        {walletAddress && (
          <a
            href={`https://basescan.org/address/${walletAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--muted)] no-underline"
          >
            {truncateAddress(walletAddress)}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ["Vault Holdings", isVaultBalanceLoading ? "..." : fmtUsd(vaultBalance), "Current on-chain vault USDC balance"],
          ["Active Value", fmtUsd(activeValue), "Estimated mark-to-market value of open positions"],
          ["Unrealised P&L", `${unrealisedPnl >= 0 ? "+" : ""}${fmtUsd(unrealisedPnl)}`, "Open-position profit and loss not yet settled"],
          ["Realised P&L", `${Number(summary?.realisedPnl ?? 0) >= 0 ? "+" : ""}${fmtUsd(summary?.realisedPnl)}`, "Closed-position profit and loss already settled"],
          ["Win Rate", summary?.resolvedCount ? `${Math.round(Number(summary.winRate))}%` : "-", "Share of resolved positions that finished profitable"],
        ].map(([label, value, subtext]) => (
          <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</p>
            <p className="font-mono text-lg text-[var(--foreground)]">{value}</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{subtext}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Vault Flow & Indexed Holdings</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshotSub ?? "Deposit, withdrawal, redemption, and position totals from admin snapshots."}
            </p>
          </div>
          <span className="text-xs text-[var(--muted)]">
            {(adminHoldings?.binary.length ?? 0) + (adminHoldings?.range.length ?? 0)} indexed positions
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["Deposits", fmtUsd(vaultFlow?.totalDeposits), "Total user inflows into the vault"],
            ["Withdrawals", fmtUsd(vaultFlow?.totalWithdrawals), "Total user outflows from the vault"],
            ["Redemptions", fmtUsd(vaultFlow?.totalRedemptions), "Settled claim payouts returned to wallet"],
            ["Net Deposits", fmtUsd(vaultFlow?.netDeposits), "Deposits minus withdrawals and redemptions"],
            ["Vault Txs", String(vaultFlow?.transactionCount ?? 0), "Indexed vault transactions for this user"],
          ].map(([label, value, subtext]) => (
            <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</p>
              <p className="font-mono text-sm text-[var(--foreground)]">{value}</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{subtext}</p>
            </div>
          ))}
        </div>
      </div>

      {walletAddress && (
        <div className="overflow-x-auto">
          <TransactionTable transactions={transactions} isLoading={isTransactionsLoading} />
        </div>
      )}

      {!walletAddress ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-xs text-[var(--muted)]">
          This user does not have a wallet address.
        </div>
      ) : isPortfolioLoading ? (
        <div className="glass-card p-6 text-sm text-[var(--muted)]">Loading portfolio...</div>
      ) : (
        <div className="space-y-5 overflow-x-auto">
          <PositionTable title="Active Positions" positions={activePositions} />
          <PositionTable title="Resolved Positions" positions={resolvedPositions} resolved />
        </div>
      )}
    </div>
  );
}
