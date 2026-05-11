"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, History } from "lucide-react";
import { useVaultTransactions } from "@/hooks/useVaultTransactions";

type Tab = "all" | "deposit" | "withdraw" | "buy" | "sell" | "redemption";

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function VaultTransactionHistory() {
  const { transactions, isLoading } = useVaultTransactions();
  const [tab, setTab] = useState<Tab>("all");

  const filtered = transactions.filter((tx) =>
    tab === "all" ? true : tx.type === tab
  );

  const tabs: Tab[] = ["all", "deposit", "withdraw", "buy", "sell", "redemption"];

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-5">
        <History className="w-5 h-5 text-yes" />
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          Vault Transactions
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1 text-xs transition-all ${
              tab === t
                ? "bg-yes/15 text-yes"
                : "bg-[var(--surface-hover)] text-[var(--muted-strong)]"
            }`}
          >
            {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--surface-hover)]" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="py-8 text-center text-xs text-[var(--muted)]">
          No {tab === "all" ? "" : tab} transactions yet
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((tx) => {
            const isPositive = tx.type === "deposit" || tx.type === "sell" || tx.type === "redemption";
            const colorClass = isPositive ? "text-yes" : "text-[#ff4757]";
            const bgClass = isPositive ? "bg-yes/10" : "bg-[#ff4757]/10";
            const amount = parseFloat(tx.amount).toFixed(2);
            const label =
              tx.type === "withdraw"
                ? "Withdrawal"
                : tx.type === "redemption"
                  ? "Redemption"
                  : tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
            const detail = tx.question
              ? `${tx.side ? `${tx.side} - ` : ""}${tx.question}`
              : timeAgo(tx.timestamp);
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-lg bg-[var(--surface-hover)] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${bgClass}`}
                  >
                    {isPositive ? (
                      <ArrowDownLeft className={`h-4 w-4 ${colorClass}`} />
                    ) : (
                      <ArrowUpRight className={`h-4 w-4 ${colorClass}`} />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--foreground)]">
                      {label}
                    </p>
                    <p className="max-w-[360px] truncate text-[11px] text-[var(--muted)]">
                      {detail}
                    </p>
                    {tx.question && (
                      <p className="text-[10px] text-[var(--muted)]/70">
                        {timeAgo(tx.timestamp)}
                      </p>
                    )}
                    {tx.shares && (
                      <p className="mono text-[10px] text-[var(--muted)]/70">
                        {parseFloat(tx.shares).toFixed(2)} shares
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-semibold ${colorClass}`}>
                    {isPositive ? "+" : "−"}${amount}
                  </span>
                  <a
                    href={`https://basescan.org/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-opacity hover:opacity-70"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[var(--muted)]" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
