/**
 * Retire active range markets so the queue recreates them from the current
 * RANGE_FACTORY_ADDRESS on the next tick.
 *
 * This preserves old rows/trade history by moving their date key aside instead
 * of deleting rows that may be referenced by positions/trades.
 *
 * Usage:
 *   bun run scripts/replace-active-range-markets.ts          # dry run
 *   APPLY=true bun run scripts/replace-active-range-markets.ts
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const APPLY = process.env.APPLY === "true";
const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  const active = await sql`
    SELECT id, market_type, date, status, range_cpmm_address
    FROM range_markets
    WHERE status = 'active'
      AND resolved = false
      AND range_cpmm_address IS NOT NULL
    ORDER BY id
  `;

  const activeRows = Array.from(active);
  console.log("[replace-active-range-markets] Active on-chain range markets:", activeRows);

  if (activeRows.length === 0) {
    console.log("[replace-active-range-markets] Nothing to replace.");
    await sql.end();
    return;
  }

  if (!APPLY) {
    console.log("[replace-active-range-markets] Dry run only. Re-run with APPLY=true to retire these markets.");
    await sql.end();
    return;
  }

  const retired = await sql`
    UPDATE range_markets
    SET
      status = 'cancelled',
      date = date || '-replaced-' || id::text
    WHERE status = 'active'
      AND resolved = false
      AND range_cpmm_address IS NOT NULL
    RETURNING id, market_type, date, range_cpmm_address
  `;

  console.log("[replace-active-range-markets] Retired markets:", Array.from(retired));
  console.log("[replace-active-range-markets] Restart or tick the range queue to create replacements with the new factory.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("[replace-active-range-markets] Error:", err);
  await sql.end();
  process.exit(1);
});
