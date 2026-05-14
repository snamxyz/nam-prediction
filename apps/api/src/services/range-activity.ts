type RangeActivityKind = "receipts" | "participants";

export type RangeActivityPoint = {
  timestamp: string;
  value: number;
};

export type RangeActivityResponse = {
  configured: boolean;
  target: number | null;
  points: RangeActivityPoint[];
  source?: string;
};

type RawActivityPoint = {
  timestamp?: unknown;
  ts?: unknown;
  time?: unknown;
  value?: unknown;
  count?: unknown;
};

type RawActivityResponse =
  | RawActivityPoint[]
  | {
      target?: unknown;
      points?: RawActivityPoint[];
      data?: RawActivityPoint[];
      source?: unknown;
    };

function endpointFor(kind: RangeActivityKind) {
  return kind === "receipts"
    ? process.env.RANGE_ACTIVITY_RECEIPTS_URL
    : process.env.RANGE_ACTIVITY_PARTICIPANTS_URL;
}

function toPoint(point: RawActivityPoint): RangeActivityPoint | null {
  const rawTs = point.timestamp ?? point.ts ?? point.time;
  const rawValue = point.value ?? point.count;
  const timestamp = typeof rawTs === "string" ? rawTs : null;
  const value = Number(rawValue);

  if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || !Number.isFinite(value)) {
    return null;
  }

  return { timestamp, value: Math.max(0, value) };
}

function normalizeActivity(raw: RawActivityResponse, sourceUrl: string): RangeActivityResponse {
  const rawPoints = Array.isArray(raw) ? raw : raw.points ?? raw.data ?? [];
  const points = rawPoints
    .map(toPoint)
    .filter((point): point is RangeActivityPoint => point !== null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const target = Array.isArray(raw) ? null : Number(raw.target);

  return {
    configured: true,
    target: Number.isFinite(target) ? target : null,
    points,
    source: Array.isArray(raw) || typeof raw.source !== "string" ? sourceUrl : raw.source,
  };
}

export async function fetchRangeActivity(input: {
  kind: RangeActivityKind;
  marketId: number;
  date: string;
  startTime: Date;
  endTime: Date;
}): Promise<RangeActivityResponse> {
  const endpoint = endpointFor(input.kind);
  if (!endpoint) {
    return { configured: false, target: null, points: [] };
  }

  const url = new URL(endpoint);
  url.searchParams.set("marketId", String(input.marketId));
  url.searchParams.set("type", input.kind);
  url.searchParams.set("date", input.date);
  url.searchParams.set("startTime", input.startTime.toISOString());
  url.searchParams.set("endTime", input.endTime.toISOString());

  const headers: Record<string, string> = {};
  const authHeader = process.env.RANGE_ACTIVITY_AUTH_HEADER;
  const authToken = process.env.RANGE_ACTIVITY_AUTH_TOKEN;
  if (authHeader && authToken) headers[authHeader] = authToken;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Range activity source returned ${res.status}`);
  }

  return normalizeActivity((await res.json()) as RawActivityResponse, url.origin);
}
