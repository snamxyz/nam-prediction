"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Lock,
  Menu,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ADMIN_WALLETS } from "@/lib/adminWallets";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/markets", label: "Markets", icon: BarChart3 },
  { href: "/admin/trades", label: "Trades", icon: Activity },
];

function AdminNav({ pathname, onLinkClick }: { pathname: string; onLinkClick?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onLinkClick}
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
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading, login, walletAddress } = useAuth();
  const isAdmin = walletAddress ? ADMIN_WALLETS.has(walletAddress.toLowerCase()) : false;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    <div className="flex min-h-screen flex-col md:flex-row gap-0">
      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_95%,transparent)] px-4 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" style={{ color: "var(--yes)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            Admin
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((o) => !o)}
          className="rounded-lg p-2 transition-colors"
          style={{ color: "var(--foreground)" }}
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer backdrop */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-[45] bg-black/50"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 flex-shrink-0 py-8 px-4 transition-transform duration-200 md:hidden ${
          mobileMenuOpen ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none"
        }`}
        style={{
          background: "var(--surface)",
          borderRight: "1px solid var(--border-subtle)",
          paddingTop: "4.5rem",
        }}
        aria-hidden={!mobileMenuOpen}
      >
        <div className="mb-8 px-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" style={{ color: "var(--yes)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Admin
            </span>
          </div>
        </div>
        <AdminNav pathname={pathname} onLinkClick={() => setMobileMenuOpen(false)} />
      </aside>

      {/* Desktop side nav */}
      <aside
        className="hidden md:block w-56 flex-shrink-0 py-8 px-4 rounded-xl"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border-subtle)" }}
      >
        <div className="mb-8 px-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: "var(--yes)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Admin
            </span>
          </div>
        </div>
        <AdminNav pathname={pathname} />
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto p-4 pt-[4.5rem] md:p-8 md:pt-8">{children}</main>
    </div>
  );
}
