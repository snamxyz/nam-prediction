"use client";

import { useState } from "react";
import { useAdminMarkets } from "@/hooks/useAdmin";

type Status = "all" | "active" | "resolved";

export default function AdminMarketsPage() {
  const [status, setStatus] = useState<Status>("all");
  const { data, isLoading } = useAdminMarkets(status);
  const markets = data?.markets ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "#e8e9ed" }}>Markets</h1>
      <div className="flex gap-2 mb-4">
        {(["all", "active", "resolved"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className="px-3 py-1.5 rounded-lg text-xs transition-all"
            style={
              status === s
                ? { background: "rgba(1,210,67,0.15)", color: "#01d243" }
                : { background: "rgba(31,32,40,0.50)", color: "#717182" }
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
              <tr style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
                {["Question", "Cadence", "Status", "Trades", "Volume"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: "#717182" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-xs" style={{ color: "#717182" }}>No markets found</td>
                </tr>
              )}
              {markets.map((m) => (
                <tr key={m.id} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
                  <td className="px-5 py-3 text-xs max-w-xs" style={{ color: "#e8e9ed" }}>
                    <span className="line-clamp-2">{m.question}</span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#717182" }}>{m.cadence}</td>
                  <td className="px-5 py-3">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-md"
                      style={
                        m.resolved
                          ? { background: "rgba(113,113,130,0.15)", color: "#717182" }
                          : { background: "rgba(1,210,67,0.15)", color: "#01d243" }
                      }
                    >
                      {m.resolved ? (m.result === 1 ? "YES won" : m.result === 2 ? "NO won" : "Resolved") : "Active"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#e8e9ed" }}>{m.tradeCount}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#01d243" }}>${parseFloat(m.totalVolume).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
