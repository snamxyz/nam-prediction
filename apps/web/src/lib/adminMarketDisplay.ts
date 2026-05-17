import type { AdminMarket, AdminMarketFamily } from "@/hooks/useAdmin";
import { ResolutionSource, type ResolutionSourceType } from "@nam-prediction/shared";
import { formatMarketQuestion } from "@/lib/marketDisplay";

const RESOLUTION_SOURCES = new Set<string>(Object.values(ResolutionSource));

function adminResolutionSource(
  market: Pick<AdminMarket, "resolutionSource" | "cadence" | "marketType">
): ResolutionSourceType {
  if (market.resolutionSource && RESOLUTION_SOURCES.has(market.resolutionSource)) {
    return market.resolutionSource as ResolutionSourceType;
  }
  if (market.cadence === "24h" || market.marketType === "24h") {
    return ResolutionSource.DEXSCREENER;
  }
  return ResolutionSource.ADMIN;
}

export function formatAdminMarketQuestion(
  market: Pick<AdminMarket, "question" | "endTime" | "resolutionSource" | "cadence" | "marketType">
) {
  if (!market.endTime) return market.question;
  return formatMarketQuestion({
    question: market.question,
    endTime: market.endTime,
    resolutionSource: adminResolutionSource(market),
  });
}

export type AdminFamilyMeta = {
  key: AdminMarketFamily;
  label: string;
  badge: string;
  description: string;
  path: string;
};

export const ADMIN_MARKET_FAMILIES: AdminFamilyMeta[] = [
  {
    key: "token",
    label: "Token Price",
    badge: "24-Hour Market",
    description: "Daily NAM price direction markets.",
    path: "/admin/markets/token",
  },
  {
    key: "participants",
    label: "Participants",
    badge: "Daily Range",
    description: "Daily participant market activity.",
    path: "/admin/markets/participants",
  },
  {
    key: "receipts",
    label: "Receipts",
    badge: "Daily Range",
    description: "Daily receipt market activity.",
    path: "/admin/markets/receipts",
  },
];

export function getAdminMarketFamily(market: AdminMarket): AdminMarketFamily | null {
  if (market.cadence === "24h" || market.marketType === "24h") return "token";
  if (market.marketType === "participants") return "participants";
  if (market.marketType === "receipts") return "receipts";
  return null;
}

export function getFamilyMeta(family: AdminMarketFamily) {
  return ADMIN_MARKET_FAMILIES.find((item) => item.key === family);
}

export function isAdminMarketFamily(value: string): value is AdminMarketFamily {
  return value === "token" || value === "participants" || value === "receipts";
}

export function getTodayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function formatAdminMarketDate(market: AdminMarket) {
  if (market.date) return market.date;
  const source = market.endTime ?? market.createdAt;
  return new Date(source).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export function formatMoney(value: string | number | undefined) {
  const n = typeof value === "number" ? value : parseFloat(value ?? "0");
  return `$${n.toFixed(2)}`;
}

export function formatCompactMoney(value: string | number | undefined) {
  const n = typeof value === "number" ? value : parseFloat(value ?? "0");
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function statusText(market: AdminMarket) {
  if (!market.resolved) return market.status ?? "active";
  if (market.category === "range") return `Range ${Math.max(0, market.result - 1)} won`;
  if (market.result === 1) return "YES won";
  if (market.result === 2) return "NO won";
  return "Resolved";
}

export function formatMarketType(market: AdminMarket) {
  if (market.marketType === "receipts") return "Receipts";
  if (market.marketType === "participants") return "Participants";
  if (market.marketType === "24h" || market.cadence === "24h") return "24h";
  return "Binary";
}

export function formatShortAddress(address: string | null | undefined) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sortMarketsByDay(markets: AdminMarket[]) {
  return [...markets].sort((a, b) => {
    const aTime = new Date(a.date ?? a.endTime ?? a.createdAt).getTime();
    const bTime = new Date(b.date ?? b.endTime ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

export function findCurrentMarket(markets: AdminMarket[], family: AdminMarketFamily) {
  const sorted = sortMarketsByDay(markets);
  if (family === "token") return sorted[0];

  const today = getTodayET();
  return sorted.find((market) => market.date === today) ?? null;
}
