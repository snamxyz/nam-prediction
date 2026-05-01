"use client";

import { useMemo, useState } from "react";
import { useAdminUsers } from "@/hooks/useAdmin";
import { useVaultUserBalances } from "@/hooks/useVaultUserBalances";
import { CheckCheck, Copy, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

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

function truncateAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

function getIdentity(loginMethod: string | null, displayName: string | null) {
  if (loginMethod === "wallet") return "";
  return displayName ?? "";
}

export default function AdminUsersPage() {
  const { data, isLoading } = useAdminUsers();
  const users = data?.users ?? [];
  const walletAddresses = useMemo(
    () => users.map((u) => u.walletAddress).filter((address): address is `0x${string}` => !!address),
    [users],
  );
  const { data: vaultBalances, isLoading: vaultBalancesLoading } = useVaultUserBalances(walletAddresses);
  const [search, setSearch] = useState("");
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const identity = getIdentity(u.loginMethod, u.displayName).toLowerCase();
      const wallet = u.walletAddress?.toLowerCase() ?? "";
      return identity.includes(q) || wallet.includes(q);
    });
  }, [search, users]);

  const copyWallet = async (walletAddress: string) => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedWallet(walletAddress);
      toast.success("Wallet address copied");
      setTimeout(() => setCopiedWallet(null), 1800);
    } catch {
      toast.error("Failed to copy wallet address");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>Users</h1>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user or wallet"
            className="w-full rounded-full py-2 pl-9 pr-3 text-xs outline-none"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-subtle)",
              color: "var(--foreground)",
            }}
          />
        </div>
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
                {["User", "Wallet", "Vault Holdings", "Trades", "Volume", "Joined"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs" style={{ color: "var(--muted)" }}>
                    {search ? "No users match your search" : "No users found"}
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => {
                const walletKey = u.walletAddress?.toLowerCase();
                const vaultBalance = walletKey ? vaultBalances?.balances[walletKey] : undefined;
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="px-5 py-3">
                      <span className="text-xs" style={{ color: getIdentity(u.loginMethod, u.displayName) ? "var(--foreground)" : "var(--muted)" }}>
                        {getIdentity(u.loginMethod, u.displayName) || "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs" style={{ color: "var(--foreground)" }}>
                          {u.walletAddress ? truncateAddress(u.walletAddress) : "—"}
                        </span>
                        {u.walletAddress && (
                          <>
                            <button
                              type="button"
                              onClick={() => copyWallet(u.walletAddress!)}
                              className="rounded p-0.5 transition-all"
                              style={{ color: copiedWallet === u.walletAddress ? "var(--yes)" : "var(--muted)" }}
                              title="Copy wallet address"
                              aria-label="Copy wallet address"
                            >
                              {copiedWallet === u.walletAddress ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                            <a
                              href={`https://basescan.org/address/${u.walletAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="View wallet on Basescan"
                            >
                              <ExternalLink className="w-3 h-3" style={{ color: "var(--muted)" }} />
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs font-medium" style={{ color: "var(--yes)" }}>
                      {vaultBalancesLoading ? "…" : fmt(vaultBalance ?? "0")}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--foreground)" }}>{u.tradeCount}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--yes)" }}>{fmt(u.totalVolume)}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: "var(--muted)" }}>{timeAgo(u.createdAt)}</td>
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
