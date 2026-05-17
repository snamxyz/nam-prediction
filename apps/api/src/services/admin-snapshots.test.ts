import { describe, expect, test } from "bun:test";
import {
  computeMarketLiquidityAtRisk,
  summarizeBinaryPositionRows,
  summarizeRangePositionRows,
} from "./admin-snapshots";

describe("admin snapshot holding summaries", () => {
  test("summarizes binary holders, open interest, and concentration", () => {
    const summaries = summarizeBinaryPositionRows([
      { marketId: 1, userAddress: "0xA", yesBalance: "3", noBalance: "1" },
      { marketId: 1, userAddress: "0xB", yesBalance: "1", noBalance: "0" },
      { marketId: 2, userAddress: "0xA", yesBalance: "0", noBalance: "2" },
    ]);

    const marketOne = summaries.get(1)!;
    expect(marketOne.holderCount).toBe(2);
    expect(marketOne.totalYesShares).toBe(4);
    expect(marketOne.totalNoShares).toBe(1);
    expect(marketOne.openInterestShares).toBe(5);
    expect(marketOne.largestHolderShares).toBe(4);
    expect(marketOne.holderConcentrationPct).toBeCloseTo(80, 6);
  });

  test("deduplicates range holders across outcome rows", () => {
    const summaries = summarizeRangePositionRows([
      { rangeMarketId: 1, userAddress: "0xA", balance: "2" },
      { rangeMarketId: 1, userAddress: "0xA", balance: "3" },
      { rangeMarketId: 1, userAddress: "0xB", balance: "5" },
    ]);

    const marketOne = summaries.get(1)!;
    expect(marketOne.holderCount).toBe(2);
    expect(marketOne.totalRangeShares).toBe(10);
    expect(marketOne.largestHolderShares).toBe(5);
    expect(marketOne.holderConcentrationPct).toBeCloseTo(50, 6);
  });
});

describe("computeMarketLiquidityAtRisk", () => {
  test("uses active liquidity before resolution", () => {
    expect(
      computeMarketLiquidityAtRisk({
        resolved: false,
        liquidity: 100,
        reservedClaims: 50,
        outstandingWinningClaims: 25,
      })
    ).toBe(100);
  });

  test("uses claims after resolution", () => {
    expect(
      computeMarketLiquidityAtRisk({
        resolved: true,
        liquidity: 100,
        reservedClaims: 50,
        outstandingWinningClaims: 25,
      })
    ).toBe(75);
  });
});
