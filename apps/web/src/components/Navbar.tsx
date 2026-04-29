"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNamPrice } from "@/hooks/useNamPrice";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

export function Navbar() {
  const { login, logout, isAuthenticated, walletAddress } = useAuth();
  const pathname = usePathname();
  const { price } = useNamPrice();
  const { theme, toggleTheme } = useTheme();
  const prevPriceRef = useRef<number | null>(null);
  const up =
    price !== null &&
    (prevPriceRef.current === null || price >= prevPriceRef.current);
  if (price !== null && price !== prevPriceRef.current) prevPriceRef.current = price;

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "";

  const navLinks = [
    { href: "/", label: "Markets" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/admin/dashboard", label: "Admin" },
  ];

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_95%,transparent)] backdrop-blur-2xl"
    >
      <div className="mx-auto flex h-[54px] max-w-[1280px] items-center px-6">
        {/* Logo */}
        <Link
          href="/"
          className="mr-8 flex shrink-0 items-center gap-2"
        >
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
        <nav className="flex gap-0.5 flex-1">
          {navLinks.map(({ href, label }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
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
              <LogOut className="w-4 h-4 text-red-500" />
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
    </header>
  );
}
