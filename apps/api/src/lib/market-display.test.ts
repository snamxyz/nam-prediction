import { describe, expect, test } from "bun:test";
import { formatMarketQuestion } from "./market-display";

describe("formatMarketQuestion", () => {
  test("formats dexscreener threshold question from endTime", () => {
    const formatted = formatMarketQuestion({
      question:
        "Will NAM be >= $0.467300 at 00:00 ET on 2026-05-15?",
      endTime: "2026-05-15T04:00:00.000Z",
      resolutionSource: "dexscreener",
    });
    expect(formatted).toBe("NAM Up or Down on May 14?");
  });

  test("leaves non-dexscreener questions unchanged", () => {
    const question = "How many participants on May 14?";
    expect(
      formatMarketQuestion({
        question,
        endTime: "2026-05-15T04:00:00.000Z",
        resolutionSource: "admin",
      })
    ).toBe(question);
  });
});
