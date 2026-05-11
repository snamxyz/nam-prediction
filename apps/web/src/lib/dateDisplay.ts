export const EASTERN_TIME_ZONE = "America/New_York";

export function formatEasternMarketDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  // Markets resolve at midnight ET, so the market day is the day that just ended.
  const marketDay = new Date(date.getTime() - 1);
  return marketDay.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: EASTERN_TIME_ZONE,
  });
}

export function formatEasternShortDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: EASTERN_TIME_ZONE,
  });
}
