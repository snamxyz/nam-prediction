"use client";

import { useAdminTrades } from "@/hooks/useAdmin";
import { ExternalLink } from "lucide-react";

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AdminTradesPage() {
  const { data, isLoading } = useAdminTrades();
  const trades = data?.trades ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "var(--foreground)" }}>Recent Trades</h1>
      {isLoading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="glass-card p-4 h-14 animate-pulse" />
          ))}
        </div>
      )}
      {!isLoading && (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Trader", "Market", "Side", "Type", "Amount", "Shares", "Time", "Tx"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs" style={{ color: "var(--muted)" }}>No trades yet</td>
                </tr>
              )}
              {trades.map((t) => {
                const isBuy = t.isBuy;
                const isYes = t.side === "YES";
                const sideColor = isYes ? "var(--yes)" : "var(--no)";
                const typeColor = isBuy ? "var(--yes)" : "var(--no)";
                const sideBg = isYes ? "rgba(1,210,67,0.12)" : "rgba(240,50,76,0.12)";
                const typeBg = isBuy ? "rgba(1,210,67,0.12)" : "rgba(240,50,76,0.12)";
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--foreground)" }}>
                      {t.traderAddress ? `${t.traderAddress.slice(0, 6)}…${t.traderAddress.slice(-4)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[160px]" style={{ color: "var(--muted)" }}>
                      <span className="line-clamp-1">{t.question}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: sideBg, color: sideColor }}>
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: typeBg, color: typeColor }}>
                        {isBuy ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground)" }}>
                      ${parseFloat(t.collateral).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground)" }}>
                      {parseFloat(t.shares).toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                      {timeAgo(t.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://basescan.org/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-opacity hover:opacity-70"
                      >
                        <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
