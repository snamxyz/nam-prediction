const EASTERN_TIME_ZONE = "America/New_York";

export type MarketDisplayInput = {
  question: string;
  endTime: string | Date;
  resolutionSource: string;
};

export function formatEasternMarketDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  const marketDay = new Date(date.getTime() - 1);
  return marketDay.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: EASTERN_TIME_ZONE,
  });
}

export function isNamPriceMarket(market?: Pick<MarketDisplayInput, "resolutionSource"> | null) {
  return market?.resolutionSource === "dexscreener";
}

export function formatMarketQuestion(market: MarketDisplayInput) {
  if (!isNamPriceMarket(market)) return market.question;

  const date = formatEasternMarketDay(market.endTime);
  if (!date) return market.question;

  return `NAM Up or Down on ${date}?`;
}
