/**
 * Create a 1-hour NAM market.
 *
 * Usage:
 *   bun run src/scripts/create-hourly-market.ts
 *   bun run src/scripts/create-hourly-market.ts <threshold>
 *   bun run src/scripts/create-hourly-market.ts <threshold> <comparison>
 *
 * comparison: ">=" | "<=" (default: ">=")
 */
import { createNextHourlyMarket } from "../services/hourly-market";

function readComparison(input: string | undefined): ">=" | "<=" {
  if (input === "<=") return "<=";
  return ">=";
}

async function main() {
  const cliThreshold = process.argv[2];
  const cliComparison = process.argv[3];
  const comparison = readComparison(cliComparison);

  let threshold: number | undefined;
  if (cliThreshold) {
    threshold = Number(cliThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(`Invalid threshold: ${cliThreshold}`);
    }
  }

  await createNextHourlyMarket(comparison, threshold);
}

main()
  .then(async () => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Hourly] Failed to create market:", err);
    process.exit(1);
  });
