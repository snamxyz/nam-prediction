/**
 * Create a 15-minute NAM market.
 *
 * Usage:
 *   bun run src/scripts/create-15m-market.ts
 *   bun run src/scripts/create-15m-market.ts <threshold>
 *   bun run src/scripts/create-15m-market.ts <threshold> <comparison>
 *
 * comparison: ">=" | "<=" (default: ">=")
 */
import { createNextM15Market } from "../services/m15-market";

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

  await createNextM15Market(comparison, threshold);
}

main()
  .then(async () => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[M15] Failed to create market:", err);
    process.exit(1);
  });
