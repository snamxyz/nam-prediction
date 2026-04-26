import type { Market } from "@nam-prediction/shared";

export type OutcomeDisplayLabels = {
  yes: string;
  no: string;
  yesShort: string;
  noShort: string;
};

const DEFAULT_LABELS: OutcomeDisplayLabels = {
  yes: "Yes",
  no: "No",
  yesShort: "YES",
  noShort: "NO",
};

const NAM_PRICE_LABELS: OutcomeDisplayLabels = {
  yes: "Up",
  no: "Down",
  yesShort: "UP",
  noShort: "DOWN",
};

export function isNamPriceMarket(market?: Pick<Market, "resolutionSource"> | null) {
  return market?.resolutionSource === "dexscreener";
}

export function getOutcomeLabels(market?: Pick<Market, "resolutionSource"> | null) {
  return isNamPriceMarket(market) ? NAM_PRICE_LABELS : DEFAULT_LABELS;
}

export function formatMarketQuestion(
  market: Pick<Market, "question" | "endTime" | "resolutionSource">
) {
  if (!isNamPriceMarket(market)) return market.question;

  const end = new Date(market.endTime);
  if (Number.isNaN(end.getTime())) return market.question;

  const date = end.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return `NAM Up or Down on ${date}?`;
}
