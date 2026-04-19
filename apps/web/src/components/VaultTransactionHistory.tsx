"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, History } from "lucide-react";
import { useVaultTransactions } from "@/hooks/useVaultTransactions";

type Tab = "all" | "deposit" | "withdraw";

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

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-5">
        <History className="w-5 h-5" style={{ color: "#01d243" }} />
        <h2 className="text-base font-semibold" style={{ color: "#e8e9ed" }}>
          Vault Transactions
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["all", "deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1 rounded-lg text-xs transition-all"
            style={
              tab === t
                ? { background: "rgba(1,210,67,0.15)", color: "#01d243" }
                : { background: "rgba(31,32,40,0.50)", color: "#717182" }
            }
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "rgba(31,32,40,0.45)" }} />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="text-xs text-center py-8" style={{ color: "#717182" }}>
          No {tab === "all" ? "" : tab} transactions yet
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((tx) => {
            const isDeposit = tx.type === "deposit";
            const C = isDeposit ? "#01d243" : "#ff4757";
            const amount = parseFloat(tx.amount).toFixed(2);
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between px-4 py-3 rounded-lg"
                style={{ background: "rgba(31,32,40,0.45)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${C}18` }}
                  >
                    {isDeposit ? (
                      <ArrowDownLeft className="w-4 h-4" style={{ color: C }} />
                    ) : (
                      <ArrowUpRight className="w-4 h-4" style={{ color: C }} />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "#e8e9ed" }}>
                      {isDeposit ? "Deposit" : "Withdrawal"}
                    </p>
                    <p className="text-[11px]" style={{ color: "#717182" }}>
                      {timeAgo(tx.timestamp)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold" style={{ color: C }}>
                    {isDeposit ? "+" : "−"}${amount}
                  </span>
                  <a
                    href={`https://basescan.org/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-opacity hover:opacity-70"
                  >
                    <ExternalLink className="w-3.5 h-3.5" style={{ color: "#717182" }} />
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
