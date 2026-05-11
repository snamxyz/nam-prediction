"use client";

import { useState } from "react";
import { useAdminMarkets, type AdminMarket } from "@/hooks/useAdmin";

type Status = "all" | "active" | "resolved";
type FamilyKey = "token" | "participants" | "receipts";

function fmtMoney(value: string | undefined) {
  const n = parseFloat(value ?? "0");
  return `$${n.toFixed(2)}`;
}

function formatType(marketType: string | undefined, cadence: string) {
  if (marketType === "receipts") return "Receipts";
  if (marketType === "participants") return "Participants";
  if (marketType === "24h" || cadence === "24h") return "24h";
  return "Binary";
}

function getFamily(market: AdminMarket): FamilyKey | null {
  if (market.cadence === "24h" || market.marketType === "24h") return "token";
  if (market.marketType === "participants") return "participants";
  if (market.marketType === "receipts") return "receipts";
  return null;
}

function formatDate(market: AdminMarket) {
  if (market.date) return market.date;
  const source = market.endTime ?? market.createdAt;
  return new Date(source).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function statusText(market: AdminMarket) {
  if (!market.resolved) return market.status ?? "active";
  if (market.category === "range") return `Range ${Math.max(0, market.result - 1)} won`;
  if (market.result === 1) return "YES won";
  if (market.result === 2) return "NO won";
  return "Resolved";
}

export default function AdminMarketsPage() {
  const [status, setStatus] = useState<Status>("all");
  const [selectedFamily, setSelectedFamily] = useState<FamilyKey>("token");
  const { data, isLoading } = useAdminMarkets(status);
  const markets = data?.markets ?? [];
  const familyMarkets = markets.filter((market) => getFamily(market) === selectedFamily);
  const families: Array<{ key: FamilyKey; label: string; description: string }> = [
    { key: "token", label: "Token Price", description: "Daily NAM up/down price markets" },
    { key: "participants", label: "Participants / Miners", description: "Daily participant or miner count markets" },
    { key: "receipts", label: "Total Receipts", description: "Daily receipt upload markets" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--foreground)" }}>Markets</h1>
      <p className="mb-6 max-w-3xl text-xs leading-5" style={{ color: "var(--muted)" }}>
        Monitor the three production market families by day, including seeded liquidity, pool health, claims, and house P&L.
      </p>
      <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {families.map((family) => {
          const familyRows = markets.filter((market) => getFamily(market) === family.key);
          const active = selectedFamily === family.key;
          const latest = familyRows[0];
          return (
            <button
              key={family.key}
              onClick={() => setSelectedFamily(family.key)}
              className="card cursor-pointer p-4 text-left transition hover:border-yes/30"
              style={{
                borderColor: active ? "rgba(1,210,67,0.45)" : "var(--border)",
                background: active ? "rgba(1,210,67,0.08)" : "var(--surface)",
              }}
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: active ? "var(--yes)" : "var(--muted)" }}>
                {familyRows.length} days
              </div>
              <div className="mb-1 text-sm font-semibold" style={{ color: "var(--foreground)" }}>{family.label}</div>
              <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>{family.description}</p>
              <div className="flex justify-between text-xs">
                <span style={{ color: "var(--muted)" }}>Latest</span>
                <span className="mono" style={{ color: "var(--foreground)" }}>{latest ? formatDate(latest) : "—"}</span>
              </div>
            </button>
          );
        })}
      </div>

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
        <div className="space-y-3">
          {familyMarkets.length === 0 && (
            <div className="glass-card px-5 py-8 text-center text-xs" style={{ color: "var(--muted)" }}>
              No markets found for this family.
            </div>
          )}
          {familyMarkets.map((m) => (
            <div key={`${m.marketType ?? m.cadence}-${m.id}`} className="glass-card p-4">
              <div className="mb-3 flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--surface-hover)", color: "var(--muted)" }}>
                      {formatDate(m)}
                    </span>
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: m.resolved ? "var(--surface-hover)" : "rgba(1,210,67,0.15)", color: m.resolved ? "var(--muted)" : "var(--yes)" }}>
                      {statusText(m)}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--muted)" }}>{formatType(m.marketType, m.cadence)}</span>
                  </div>
                  <div className="max-w-3xl text-sm font-medium" style={{ color: "var(--foreground)" }}>{m.question}</div>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>Liquidity State</div>
                  <div className="text-xs" style={{ color: "var(--foreground)" }}>{m.liquidityState ?? "—"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
                {[
                  ["Trades", String(m.tradeCount)],
                  ["Volume", fmtMoney(m.totalVolume)],
                  ["Seeded", fmtMoney(m.seededLiquidity ?? m.liquidity)],
                  ["Liquidity", fmtMoney(m.liquidity)],
                  ["Claims", fmtMoney(m.outstandingWinningClaims)],
                  ["House P&L", fmtMoney(m.housePnl)],
                  ["Pool", m.poolAddress ? `${m.poolAddress.slice(0, 6)}…${m.poolAddress.slice(-4)}` : "—"],
                  ["On-chain", m.onChainId ? `#${m.onChainId}` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-3 py-2">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.07em]" style={{ color: "var(--muted)" }}>{label}</div>
                    <div className="mono text-xs" style={{ color: label === "House P&L" && parseFloat(m.housePnl ?? "0") < 0 ? "var(--no)" : "var(--foreground)" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
