"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNamPrice } from "@/hooks/useNamPrice";
import { LogOut } from "lucide-react";

export function Navbar() {
  const { login, logout, isAuthenticated, walletAddress } = useAuth();
  const pathname = usePathname();
  const { price } = useNamPrice();
  const prevPriceRef = useRef<number | null>(null);
  const up = price !== null && (prevPriceRef.current === null || price >= prevPriceRef.current);
  if (price !== null && price !== prevPriceRef.current) prevPriceRef.current = price;

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "";

  const navLinks = [
    { href: "/", label: "Markets" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "#07080cf2",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div
        className="mx-auto flex items-center"
        style={{ maxWidth: 1280, padding: "0 24px", height: 54 }}
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0"
          style={{ marginRight: 32 }}
        >
          <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
            <polyline
              points="1,13 5,4 9,10 13,6 17,2 21,13"
              stroke="#01d243"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#e4e5eb",
            }}
          >
            NAM
          </span>
          <span
            style={{
              fontSize: 11,
              color: "#4c4e68",
              fontWeight: 500,
              marginTop: 1,
            }}
          >
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
                style={{
                  padding: "6px 13px",
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: 500,
                  background: isActive ? "#111320" : "transparent",
                  color: isActive ? "#e4e5eb" : "#4c4e68",
                  transition: "all 0.12s",
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* NAM price chip */}
        <div
          className="flex items-center gap-1.5"
          style={{
            padding: "5px 12px",
            borderRadius: 7,
            background: "#111320",
            border: "1px solid rgba(255,255,255,0.07)",
            marginRight: 12,
          }}
        >
          <span className="live-dot" />
          <span
            className="mono"
            style={{ fontSize: 11, color: "#4c4e68" }}
          >
            NAM/USDC
          </span>
          <span
            className="mono"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: up ? "#01d243" : "#f0324c",
            }}
          >
            {price !== null ? `$${price.toFixed(5)}` : "$—"}
          </span>
        </div>

        {/* Wallet button */}
        {isAuthenticated ? (<div className="flex items-center gap-1.5">
          <Link
            href="/wallet"
            className="flex items-center gap-1.5 mono"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "#0d0e14",
              border: "1px solid rgba(255,255,255,0.07)",
              fontSize: 12,
              color: "#e4e5eb",
            }}
          >
            {truncatedAddress}
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 mono bg-red-500/5 border-red-500/10 border"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              color: "#e4e5eb",
            }}
          >
            <LogOut className="w-4 h-4 text-red-500" />
          </button>
          </div>
        ) : (
          <button
            onClick={login}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              background: "#01d243",
              color: "#000",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
