/**
 * Reset stale "creating" range market records so the queue retries them.
 * Usage: bun run scripts/reset-range-markets.ts
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  // Show what we'll touch
  const stale = await sql`
    SELECT id, market_type, date, status
    FROM range_markets
    WHERE status IN ('creating', 'failed')
    ORDER BY id
  `;
  console.log("[reset-range-markets] Stale records:", stale);

  if (stale.length === 0) {
    console.log("[reset-range-markets] Nothing to reset.");
    await sql.end();
    return;
  }

  // Mark all "creating" / "failed" records as cancelled so the queue retries
  const result = await sql`
    UPDATE range_markets
    SET status = 'cancelled'
    WHERE status IN ('creating', 'failed')
    RETURNING id, market_type, date
  `;
  console.log("[reset-range-markets] ✓ Reset", result.length, "records to 'cancelled':", result);
  await sql.end();
}

main().catch((err) => {
  console.error("[reset-range-markets] Error:", err);
  process.exit(1);
});
