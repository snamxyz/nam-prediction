"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNamPrice } from "@/hooks/useNamPrice";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import {
  BarChart2,
  Briefcase,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { ADMIN_WALLETS } from "@/lib/adminWallets";

export function Navbar() {
  const { login, logout, isAuthenticated, walletAddress } = useAuth();
  const pathname = usePathname();
  const { price } = useNamPrice();
  const { usdcBalance, isLoading: isBalanceLoading } = useVaultBalance();
  const { theme, toggleTheme } = useTheme();
  const prevPriceRef = useRef<number | null>(null);
  const up =
    price !== null &&
    (prevPriceRef.current === null || price >= prevPriceRef.current);
  if (price !== null && price !== prevPriceRef.current) prevPriceRef.current = price;

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "";
  const isAdmin = walletAddress
    ? ADMIN_WALLETS.has(walletAddress.toLowerCase())
    : false;

  const navLinks = [
    { href: "/", label: "Markets", icon: BarChart2 },
    { href: "/portfolio", label: "Portfolio", icon: Briefcase },
    ...(isAdmin
      ? [{ href: "/admin/dashboard", label: "Admin", icon: ShieldCheck }]
      : []),
  ];

  const isActiveLink = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const isAdminRoute = pathname.startsWith("/admin");

  return (
    <>
      <header
        className={`sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_95%,transparent)] backdrop-blur-2xl ${
          isAdminRoute ? "hidden md:block" : ""
        }`}
      >
        <div className="mx-auto hidden h-[54px] max-w-[1280px] items-center px-6 md:flex">
          {/* Logo */}
          <Link href="/" className="mr-8 flex shrink-0 items-center gap-2">
            <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
              <polyline
                points="1,13 5,4 9,10 13,6 17,2 21,13"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span className="text-sm font-bold tracking-[-0.02em] text-[var(--foreground)]">
              NAM
            </span>
            <span className="mt-px text-[11px] font-medium text-[var(--muted)]">
              Predict
            </span>
          </Link>

          {/* Nav links */}
          <nav className="flex flex-1 gap-0.5">
            {navLinks.map(({ href, label }) => {
              const isActive = isActiveLink(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-[7px] px-[13px] py-1.5 text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-[var(--surface-hover)] text-[var(--foreground)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* NAM price chip */}
          <div className="mr-3 flex items-center gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-[5px]">
            <span className="live-dot" />
            <span className="mono text-[11px] text-[var(--muted)]">
              NAM/USDC
            </span>
            <span
              className={`mono text-xs font-medium ${
                up ? "text-[var(--yes)]" : "text-[var(--no)]"
              }`}
            >
              {price !== null ? `$${price.toFixed(5)}` : "$—"}
            </span>
          </div>

          {/* Vault balance chip */}
          {isAuthenticated && (
            <Link
              href="/portfolio"
              className="mr-3 flex items-center gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-[5px] no-underline"
              title="Vault Balance"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
                Vault
              </span>
              <span className="mono text-xs font-medium text-[var(--yes)]">
                {isBalanceLoading
                  ? "$—"
                  : `$${parseFloat(usdcBalance).toFixed(2)}`}
              </span>
            </Link>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Wallet button */}
          {isAuthenticated ? (
            <div className="flex items-center gap-1.5">
              <Link
                href="/wallet"
                className="mono flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)]"
              >
                {truncatedAddress}
              </Link>
              <button
                onClick={logout}
                className="mono flex items-center gap-1.5 rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-1.5 text-xs text-[var(--foreground)]"
              >
                <LogOut className="h-4 w-4 text-red-500" />
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="rounded-lg bg-[var(--accent)] px-4 py-[7px] text-[13px] font-bold text-black"
            >
              Connect Wallet
            </button>
          )}
        </div>

        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                <polyline
                  points="1,13 5,4 9,10 13,6 17,2 21,13"
                  stroke="var(--accent)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold tracking-[-0.02em] text-[var(--foreground)]">
                  NAM
                </span>
                <span className="text-[11px] font-medium text-[var(--muted)]">
                  Predict
                </span>
              </div>
            </Link>

            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              {isAuthenticated ? (
                <>
                  <Link
                    href="/wallet"
                    className="mono flex h-8 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11px] text-[var(--foreground)]"
                  >
                    {truncatedAddress}
                  </Link>
                  <button
                    onClick={logout}
                    aria-label="Disconnect wallet"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/10 bg-red-500/5 text-[var(--foreground)]"
                  >
                    <LogOut className="h-4 w-4 text-red-500" />
                  </button>
                </>
              ) : (
                <button
                  onClick={login}
                  className="h-8 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-bold text-black"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between overflow-x-auto gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--surface-hover)] px-3 py-[5px]">
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="live-dot" />
              <span className="mono text-[11px] text-[var(--muted)]">
                NAM
              </span>
              <span
                className={`mono text-xs font-medium ${
                  up ? "text-[var(--yes)]" : "text-[var(--no)]"
                }`}
              >
                {price !== null ? `$${price.toFixed(5)}` : "$—"}
              </span>
            </div>

            <Link
              href="/portfolio"
              className="flex shrink-0 items-center no-underline gap-1.5"
              title="Portfolio"
            >
              <Briefcase className="h-3.5 w-3.5 text-[var(--muted)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
                Portfolio
              </span>
              {isAuthenticated && (
                <span className="mono text-xs font-medium text-[var(--yes)]">
                  {isBalanceLoading
                    ? "$—"
                    : `$${parseFloat(usdcBalance).toFixed(2)}`}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <nav
        aria-label="Mobile page navigation"
        className={`fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_95%,transparent)] px-3 pb-2 pt-2 backdrop-blur-2xl md:hidden ${
          isAdminRoute ? "z-40" : "z-50"
        }`}
      >
        <div className={`mx-auto grid max-w-md gap-2 ${navLinks.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {navLinks.map(({ href, label, icon: Icon }) => {
            const isActive = isActiveLink(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all ${
                  isActive
                    ? "bg-[var(--surface-hover)] text-[var(--foreground)]"
                    : "text-[var(--muted)]"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
