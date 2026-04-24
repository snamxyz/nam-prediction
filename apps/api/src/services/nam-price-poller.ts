import { fetchNamPriceEnriched } from "./daily-market";
import { publishEvent } from "../lib/redis";

const NAM_PRICE_HISTORY_LIMIT = 180;
const NAM_POLL_INTERVAL_MS = 5_000;

export type NamPriceHistoryPoint = {
  ts: string;
  priceUsd: string;
};

export type NamSnapshot = {
  priceUsd: string;
  tokenIconUrl: string | null;
  lastUpdatedAt: string;
  history: NamPriceHistoryPoint[];
};

const history: NamPriceHistoryPoint[] = [];
let snapshot: NamSnapshot | null = null;

export function getNamSnapshot(): NamSnapshot | null {
  return snapshot;
}

async function poll(): Promise<void> {
  try {
    const result = await fetchNamPriceEnriched();
    if (!result) return;

    const { price, iconUrl } = result;
    const ts = new Date().toISOString();

    history.push({ ts, priceUsd: price.toString() });
    if (history.length > NAM_PRICE_HISTORY_LIMIT) {
      history.splice(0, history.length - NAM_PRICE_HISTORY_LIMIT);
    }

    snapshot = {
      priceUsd: price.toString(),
      tokenIconUrl: iconUrl,
      lastUpdatedAt: ts,
      history: [...history],
    };

    await publishEvent("nam:price", snapshot as unknown as Record<string, unknown>);
  } catch (err) {
    console.error("[NamPoller] Error fetching NAM price:", err);
  }
}

export function startNamPricePoller(): void {
  poll();
  setInterval(poll, NAM_POLL_INTERVAL_MS);
  console.log("[NamPoller] NAM price poller started (interval: 5s)");
}
