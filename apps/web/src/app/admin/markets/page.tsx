"use client";

import { useState } from "react";
import { useAdminMarkets } from "@/hooks/useAdmin";

type Status = "all" | "active" | "resolved";

function fmtMoney(value: string | undefined) {
  const n = parseFloat(value ?? "0");
  return `$${n.toFixed(2)}`;
}

function formatType(marketType: string | undefined, cadence: string) {
  if (marketType === "receipts") return "Receipts";
  if (marketType === "nam-distribution") return "NAM Distribution";
  if (marketType === "24h" || cadence === "24h") return "24h";
  return "Binary";
}

export default function AdminMarketsPage() {
  const [status, setStatus] = useState<Status>("all");
  const { data, isLoading } = useAdminMarkets(status);
  const markets = data?.markets ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>Markets</h1>
      <p className="mb-6 max-w-3xl text-xs leading-5" style={{ color: "var(--muted)" }}>
        Monitor live market volume, house liquidity, reserved winner claims, and drained liquidity available for pull or rollover.
      </p>
      <div className="flex gap-2 mb-4">
        {(["all", "active", "resolved"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className="px-3 py-1.5 rounded-lg text-xs transition-all"
            style={
              status === s
                ? { background: "rgba(1,210,67,0.15)", color: "var(--yes)" }
                : { background: "var(--surface-hover)", color: "var(--muted)" }
            }
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card p-4 h-14 animate-pulse" />
          ))}
        </div>
      )}
      {!isLoading && (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Question", "Type", "Status", "Trades", "Volume", "Liquidity", "Claims", "House P&L", "Liquidity State"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-xs" style={{ color: "var(--muted)" }}>No markets found</td>
                </tr>
              )}
              {markets.map((m) => (
                <tr key={`${m.marketType ?? m.cadence}-${m.id}`} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="px-5 py-3 text-xs max-w-xs" style={{ color: "var(--foreground)" }}>
                    <span className="line-clamp-2">{m.question}</span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>{formatType(m.marketType, m.cadence)}</td>
                  <td className="px-5 py-3">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-md"
                      style={
                        m.resolved
                          ? { background: "var(--surface-hover)", color: "var(--muted)" }
                          : { background: "rgba(1,210,67,0.15)", color: "var(--yes)" }
                      }
                    >
                      {m.resolved
                        ? m.category === "range"
                          ? `Range ${Math.max(0, m.result - 1)} won`
                          : m.result === 1
                            ? "YES won"
                            : m.result === 2
                              ? "NO won"
                              : "Resolved"
                        : "Active"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--foreground)" }}>{m.tradeCount}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--yes)" }}>{fmtMoney(m.totalVolume)}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--foreground)" }}>{fmtMoney(m.liquidity)}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>{fmtMoney(m.outstandingWinningClaims)}</td>
                  <td
                    className="px-5 py-3 text-xs"
                    style={{ color: parseFloat(m.housePnl ?? "0") >= 0 ? "var(--yes)" : "var(--no)" }}
                  >
                    {fmtMoney(m.housePnl)}
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>{m.liquidityState ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
