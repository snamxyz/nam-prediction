import { describe, expect, test } from "bun:test";
import {
  computeHousePnl,
  sumBinaryTraderRealisedPnl,
} from "./pnl";

describe("computeHousePnl", () => {
  test("pre-drain resolved market uses trade-based estimate (-$0.47)", () => {
    const traderPnl = 0.47;
    const { pnl, source } = computeHousePnl({
      resolved: true,
      liquidityDrained: false,
      seededLiquidity: 1,
      liquidityWithdrawn: 0,
      traderRealisedPnlSum: traderPnl,
    });
    expect(source).toBe("estimated");
    expect(pnl).toBeCloseTo(-0.47, 6);
  });

  test("post-drain uses treasury formula (-$0.47)", () => {
    const { pnl, source } = computeHousePnl({
      resolved: true,
      liquidityDrained: true,
      seededLiquidity: 1,
      liquidityWithdrawn: 0.53,
      traderRealisedPnlSum: 0.47,
    });
    expect(source).toBe("final");
    expect(pnl).toBeCloseTo(-0.47, 6);
  });

  test("old bug: pre-drain treasury formula would show -$1", () => {
    const legacyPnl = 0 - 1;
    expect(legacyPnl).toBe(-1);
    const { pnl } = computeHousePnl({
      resolved: true,
      liquidityDrained: false,
      seededLiquidity: 1,
      liquidityWithdrawn: 0,
      traderRealisedPnlSum: 0.47,
    });
    expect(pnl).not.toBe(legacyPnl);
  });

  test("unresolved market returns pending", () => {
    const { pnl, source } = computeHousePnl({
      resolved: false,
      liquidityDrained: false,
      seededLiquidity: 1,
      liquidityWithdrawn: 0,
      traderRealisedPnlSum: 0,
    });
    expect(source).toBe("pending");
    expect(pnl).toBeNull();
  });
});

describe("sumBinaryTraderRealisedPnl", () => {
  test("$1 buy redeeming $1.47 shares", () => {
    const total = sumBinaryTraderRealisedPnl([
      {
        trader: "0xuser",
        marketId: 1,
        isYes: true,
        isBuy: true,
        shares: "1.47",
        collateral: "1",
        result: 1,
      },
    ]);
    expect(total).toBeCloseTo(0.47, 6);
  });
});
