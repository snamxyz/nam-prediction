export const DUST = 1e-9;

export type BinaryExposure = {
  result: number;
  yes: number;
  no: number;
  yesCost: number;
  noCost: number;
  cashFlow: number;
};

export type RangeExposure = {
  winningRangeIndex: number | null;
  rangeIndex: number;
  shares: number;
  cost: number;
  cashFlow: number;
};

export type HousePnlSource = "final" | "estimated" | "pending";

export function reduceSide(
  sharesBefore: number,
  costBefore: number,
  sharesSold: number
) {
  const sold = Math.min(sharesSold, sharesBefore);
  const costRemoved = sharesBefore > DUST ? costBefore * (sold / sharesBefore) : 0;
  const shares = Math.max(0, sharesBefore - sold);
  const cost = shares > DUST ? Math.max(0, costBefore - costRemoved) : 0;
  return { shares, cost };
}

export function hasBinaryExposure(exposure: BinaryExposure) {
  return (
    exposure.yes > DUST ||
    exposure.no > DUST ||
    exposure.yesCost > DUST ||
    exposure.noCost > DUST
  );
}

export function hasRangeExposure(exposure: RangeExposure) {
  return exposure.shares > DUST || exposure.cost > DUST;
}

export function getBinarySettlementValue(exposure: BinaryExposure) {
  if (exposure.result === 1) return Math.max(0, exposure.yes);
  if (exposure.result === 2) return Math.max(0, exposure.no);
  return 0;
}

export function getBinaryWin(exposure: BinaryExposure) {
  return getBinarySettlementValue(exposure) > DUST;
}

export function getRangeSettlementValue(exposure: RangeExposure) {
  return exposure.rangeIndex === exposure.winningRangeIndex
    ? Math.max(0, exposure.shares)
    : 0;
}

export function getBinaryRealisedPnl(exposure: BinaryExposure) {
  if (!hasBinaryExposure(exposure)) return 0;
  return exposure.cashFlow + getBinarySettlementValue(exposure);
}

export function getRangeRealisedPnl(exposure: RangeExposure) {
  if (!hasRangeExposure(exposure)) return 0;
  return exposure.cashFlow + getRangeSettlementValue(exposure);
}

export function buildBinaryExposureMap<
  T extends {
    marketId: number;
    isYes: boolean;
    isBuy: boolean;
    shares: string;
    collateral: string;
    result: number;
  }
>(tradeRows: T[]) {
  const byMarket = new Map<number, BinaryExposure>();

  for (const trade of tradeRows) {
    const exposure =
      byMarket.get(trade.marketId) ?? {
        result: trade.result,
        yes: 0,
        no: 0,
        yesCost: 0,
        noCost: 0,
        cashFlow: 0,
      };
    const shares = Number(trade.shares || "0");
    const collateral = Number(trade.collateral || "0");
    exposure.cashFlow += trade.isBuy ? -collateral : collateral;

    if (trade.isYes) {
      if (trade.isBuy) {
        exposure.yes += shares;
        exposure.yesCost += collateral;
      } else {
        const next = reduceSide(exposure.yes, exposure.yesCost, shares);
        exposure.yes = next.shares;
        exposure.yesCost = next.cost;
      }
    } else if (trade.isBuy) {
      exposure.no += shares;
      exposure.noCost += collateral;
    } else {
      const next = reduceSide(exposure.no, exposure.noCost, shares);
      exposure.no = next.shares;
      exposure.noCost = next.cost;
    }

    byMarket.set(trade.marketId, exposure);
  }

  return byMarket;
}

export function buildRangeExposureMap<
  T extends {
    marketId: number;
    rangeIndex: number;
    isBuy: boolean;
    shares: string;
    collateral: string;
    winningRangeIndex: number | null;
  }
>(tradeRows: T[]) {
  const byPosition = new Map<string, RangeExposure>();

  for (const trade of tradeRows) {
    const key = `${trade.marketId}:${trade.rangeIndex}`;
    const exposure =
      byPosition.get(key) ?? {
        winningRangeIndex: trade.winningRangeIndex,
        rangeIndex: trade.rangeIndex,
        shares: 0,
        cost: 0,
        cashFlow: 0,
      };
    const shares = Number(trade.shares || "0");
    const collateral = Number(trade.collateral || "0");
    exposure.cashFlow += trade.isBuy ? -collateral : collateral;

    if (trade.isBuy) {
      exposure.shares += shares;
      exposure.cost += collateral;
    } else {
      const next = reduceSide(exposure.shares, exposure.cost, shares);
      exposure.shares = next.shares;
      exposure.cost = next.cost;
    }

    byPosition.set(key, exposure);
  }

  return byPosition;
}

export function sumBinaryTraderRealisedPnl<
  T extends {
    trader: string;
    marketId: number;
    isYes: boolean;
    isBuy: boolean;
    shares: string;
    collateral: string;
    result: number;
  }
>(tradeRows: T[]) {
  const byTrader = new Map<string, T[]>();
  for (const trade of tradeRows) {
    const list = byTrader.get(trade.trader) ?? [];
    list.push(trade);
    byTrader.set(trade.trader, list);
  }

  let total = 0;
  for (const traderTrades of byTrader.values()) {
    for (const exposure of buildBinaryExposureMap(traderTrades).values()) {
      total += getBinaryRealisedPnl(exposure);
    }
  }
  return total;
}

export function sumRangeTraderRealisedPnl<
  T extends {
    trader: string;
    marketId: number;
    rangeIndex: number;
    isBuy: boolean;
    shares: string;
    collateral: string;
    winningRangeIndex: number | null;
  }
>(tradeRows: T[]) {
  const byTrader = new Map<string, T[]>();
  for (const trade of tradeRows) {
    const list = byTrader.get(trade.trader) ?? [];
    list.push(trade);
    byTrader.set(trade.trader, list);
  }

  let total = 0;
  for (const traderTrades of byTrader.values()) {
    for (const exposure of buildRangeExposureMap(traderTrades).values()) {
      total += getRangeRealisedPnl(exposure);
    }
  }
  return total;
}

export function computeHousePnl(params: {
  resolved: boolean;
  liquidityDrained: boolean;
  seededLiquidity: number;
  liquidityWithdrawn: number;
  traderRealisedPnlSum: number;
}): { pnl: number | null; source: HousePnlSource } {
  if (!params.resolved) {
    return { pnl: null, source: "pending" };
  }

  if (params.liquidityDrained) {
    return {
      pnl: params.liquidityWithdrawn - params.seededLiquidity,
      source: "final",
    };
  }

  return {
    pnl: -params.traderRealisedPnlSum,
    source: "estimated",
  };
}

export function formatHousePnl(pnl: number | null) {
  if (pnl === null) return null;
  return pnl.toFixed(2);
}
