"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, LayoutDashboard, Lock, TrendingUp, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ADMIN_WALLETS } from "@/lib/adminWallets";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/markets", label: "Markets", icon: BarChart3 },
  { href: "/admin/trades", label: "Trades", icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading, login, walletAddress } = useAuth();
  const isAdmin = walletAddress ? ADMIN_WALLETS.has(walletAddress.toLowerCase()) : false;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-card p-6 text-sm" style={{ color: "var(--muted)" }}>
          Checking admin access…
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-card max-w-md p-8 text-center">
          <Lock className="mx-auto mb-4 h-8 w-8" style={{ color: "var(--muted)" }} />
          <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--foreground)" }}>
            Admin access required
          </h1>
          <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
            {!isAuthenticated
              ? "Connect an authorized admin wallet to continue."
              : "The connected wallet is not authorized for this area."}
          </p>
          {!isAuthenticated && (
            <button
              type="button"
              onClick={login}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
              style={{ background: "var(--yes)", color: "var(--background)" }}
            >
              Connect wallet
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen gap-0">
      {/* Side nav */}
      <aside
        className="w-56 flex-shrink-0 py-8 px-4 rounded-xl"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border-subtle)" }}
      >
        <div className="mb-8 px-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: "var(--yes)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Admin</span>
          </div>
        </div>
        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all"
                style={
                  active
                    ? { background: "rgba(1,210,67,0.12)", color: "var(--yes)" }
                    : { color: "var(--muted)" }
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-8 overflow-auto">{children}</main>
    </div>
  );
}
