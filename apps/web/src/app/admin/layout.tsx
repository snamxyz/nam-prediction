"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Users, TrendingUp, Activity, LayoutDashboard } from "lucide-react";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/markets", label: "Markets", icon: BarChart3 },
  { href: "/admin/trades", label: "Trades", icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen gap-0">
      {/* Side nav */}
      <aside
        className="w-56 flex-shrink-0 py-8 px-4"
        style={{ background: "rgba(15,16,22,0.95)", borderRight: "0.5px solid rgba(255,255,255,0.06)" }}
      >
        <div className="mb-8 px-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" style={{ color: "#01d243" }} />
            <span className="text-sm font-semibold" style={{ color: "#e8e9ed" }}>Admin</span>
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
                    ? { background: "rgba(1,210,67,0.12)", color: "#01d243" }
                    : { color: "#717182" }
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
