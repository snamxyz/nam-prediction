"use client";

import { useAdminUsers } from "@/hooks/useAdmin";
import { ExternalLink } from "lucide-react";

function timeAgo(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

function fmt(n: string) {
  const v = parseFloat(n);
  return `$${v.toFixed(2)}`;
}

export default function AdminUsersPage() {
  const { data, isLoading } = useAdminUsers();
  const users = data?.users ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "#e8e9ed" }}>Users</h1>
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
                {["Wallet", "Trades", "Volume", "Joined"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: "#717182" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-xs" style={{ color: "#717182" }}>No users found</td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs" style={{ color: "#e8e9ed" }}>
                        {u.wallet ? `${u.wallet.slice(0, 8)}…${u.wallet.slice(-4)}` : u.id}
                      </span>
                      {u.wallet && (
                        <a
                          href={`https://basescan.org/address/${u.wallet}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3 h-3" style={{ color: "#717182" }} />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#e8e9ed" }}>{u.tradeCount}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#01d243" }}>{fmt(u.totalVolume)}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: "#717182" }}>{timeAgo(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
