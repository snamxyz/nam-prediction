import { describe, expect, test } from "bun:test";
import { pricesFromReserves, projectBuyAfterFees } from "./amm-estimates";

describe("projectBuyAfterFees", () => {
  test("projects a YES buy price move before confirmation", () => {
    const projected = projectBuyAfterFees(
      1_000_000n,
      0n,
      0n,
      100_000_000_000_000_000_000n,
      100_000_000_000_000_000_000n,
      true
    );
    const prices = pricesFromReserves(projected.newYesReserve, projected.newNoReserve);

    expect(projected.sharesOut).toBeGreaterThan(0n);
    expect(prices.yesPrice).toBeGreaterThan(0.5);
    expect(prices.noPrice).toBeLessThan(0.5);
    expect(prices.yesPrice + prices.noPrice).toBeCloseTo(1, 12);
  });

  test("projects a NO buy price move before confirmation", () => {
    const projected = projectBuyAfterFees(
      1_000_000n,
      0n,
      0n,
      100_000_000_000_000_000_000n,
      100_000_000_000_000_000_000n,
      false
    );
    const prices = pricesFromReserves(projected.newYesReserve, projected.newNoReserve);

    expect(projected.sharesOut).toBeGreaterThan(0n);
    expect(prices.yesPrice).toBeLessThan(0.5);
    expect(prices.noPrice).toBeGreaterThan(0.5);
    expect(prices.yesPrice + prices.noPrice).toBeCloseTo(1, 12);
  });
});
