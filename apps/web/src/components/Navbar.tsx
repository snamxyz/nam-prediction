"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useVaultBalance } from "@/hooks/useVaultBalance";
import { TrendingUp, Search, Wallet, User } from "lucide-react";

export function Navbar() {
  const { login, logout, isAuthenticated } = useAuth();
  const { usdcBalance } = useVaultBalance();

  return (
    <header className="sticky top-0 z-50 w-full" style={{ background: "rgba(10,11,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <TrendingUp className="w-7 h-7" style={{ color: "#01d243" }} />
            <span className="text-xl font-semibold" style={{ color: "#e8e9ed" }}>NAM Market</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link href="/" className="transition-colors" style={{ color: "#e8e9ed" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#01d243")}
              onMouseLeave={e => (e.currentTarget.style.color = "#e8e9ed")}>
              Markets
            </Link>
            <Link href="/portfolio" className="transition-colors" style={{ color: "#717182" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
              onMouseLeave={e => (e.currentTarget.style.color = "#717182")}>
              Portfolio
            </Link>
            <Link href="/admin/create-market" className="transition-colors" style={{ color: "#717182" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#e8e9ed")}
              onMouseLeave={e => (e.currentTarget.style.color = "#717182")}>
              Create
            </Link>
          </nav>
        </div>
        {/* Right: search + wallet + auth */}
        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#717182" }} />
            <input type="text" placeholder="Search markets…"
              className="w-64 pl-10 pr-4 py-2 text-sm rounded-lg outline-none"
              style={{ background: "#1f2028", border: "1px solid rgba(255,255,255,0.08)", color: "#e8e9ed" }} />
          </div>

          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <Link
                href="/portfolio"
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-all"
                style={{ background: "#1f2028", border: "1px solid rgba(255,255,255,0.08)", color: "#e8e9ed" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(1,210,67,0.30)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
              >
                <Wallet className="w-4 h-4" style={{ color: "#01d243" }} />
                <span className="text-xs font-semibold">${parseFloat(usdcBalance).toFixed(2)}</span>
                <span className="text-[10px]" style={{ color: "#717182" }}>Vault</span>
              </Link>
              <button onClick={logout} className="px-3 py-2 text-sm rounded-lg transition-colors"
                style={{ background: "rgba(31,32,40,0.50)", color: "#717182" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(31,32,40,0.80)"; e.currentTarget.style.color = "#e8e9ed"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(31,32,40,0.50)"; e.currentTarget.style.color = "#717182"; }}>
                Disconnect
              </button>
              <Link href="/portfolio" className="p-2 rounded-lg transition-colors" style={{ color: "#e8e9ed" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#1f2028")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <User className="w-5 h-5" />
              </Link>
            </div>
          ) : (
            <button onClick={login} className="px-4 py-2 text-sm rounded-lg font-semibold transition-all"
              style={{ background: "#01d243", color: "#000" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#00e676")}
              onMouseLeave={e => (e.currentTarget.style.background = "#01d243")}>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
