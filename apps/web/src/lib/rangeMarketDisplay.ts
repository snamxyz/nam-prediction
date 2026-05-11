export const PARTICIPANTS_MARKET_TYPE = "participants";
export const RECEIPTS_MARKET_TYPE = "receipts";

export type RangeMarketKind = typeof RECEIPTS_MARKET_TYPE | typeof PARTICIPANTS_MARKET_TYPE;

export function getRangeMarketLabel(marketType?: string) {
  if (marketType === RECEIPTS_MARKET_TYPE) return "Receipts";
  if (marketType === PARTICIPANTS_MARKET_TYPE) return "Participants";
  return "Range Market";
}

export function getRangeMarketPath(marketType?: string) {
  return marketType === RECEIPTS_MARKET_TYPE ? "/markets/receipts" : "/markets/participants";
}

export function getRangeMarketAccent(marketType?: string) {
  return marketType === RECEIPTS_MARKET_TYPE
    ? {
        text: "text-[#6c7aff]",
        bg: "bg-[#6c7aff]/15",
        hover: "hover:border-[#6c7aff]/35",
        pill: "bg-[#6c7aff]/[0.12] text-[#6c7aff]",
      }
    : {
        text: "text-[#f0a832]",
        bg: "bg-[#f0a832]/15",
        hover: "hover:border-[#f0a832]/35",
        pill: "bg-[#f0a832]/[0.12] text-[#f0a832]",
      };
}
