/**
 * Dangerous one-off maintenance script.
 *
 * Wipes every row from the `markets` table and cascades into every dependent
 * table (trades, user_positions, holdings, orders, order_fills, settlements,
 * daily_markets, resolution_logs, risk_events). Sequences are reset so newly
 * indexed markets start fresh at id = 1.
 *
 * Run with:  bun run apps/api/src/scripts/delete-all-markets.ts
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[delete-all-markets] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

async function main() {
  console.log("[delete-all-markets] Connected. Counting rows before wipe...");

  const [{ count: marketCount }] = (await sql`SELECT COUNT(*)::int AS count FROM markets`) as Array<{ count: number }>;
  const [{ count: tradeCount }] = (await sql`SELECT COUNT(*)::int AS count FROM trades`) as Array<{ count: number }>;
  const [{ count: orderCount }] = (await sql`SELECT COUNT(*)::int AS count FROM orders`) as Array<{ count: number }>;
  const [{ count: positionCount }] = (await sql`SELECT COUNT(*)::int AS count FROM user_positions`) as Array<{ count: number }>;
  const [{ count: dailyCount }] = (await sql`SELECT COUNT(*)::int AS count FROM daily_markets`) as Array<{ count: number }>;

  console.log(`[delete-all-markets] Before: markets=${marketCount} trades=${tradeCount} orders=${orderCount} positions=${positionCount} daily_markets=${dailyCount}`);

  if (marketCount === 0) {
    console.log("[delete-all-markets] Nothing to delete. Exiting.");
    await sql.end();
    return;
  }

  console.log("[delete-all-markets] Truncating markets RESTART IDENTITY CASCADE...");

  await sql.begin(async (tx) => {
    await tx.unsafe(`TRUNCATE TABLE markets RESTART IDENTITY CASCADE`);
  });

  const [{ count: afterMarkets }] = (await sql`SELECT COUNT(*)::int AS count FROM markets`) as Array<{ count: number }>;
  const [{ count: afterTrades }] = (await sql`SELECT COUNT(*)::int AS count FROM trades`) as Array<{ count: number }>;
  const [{ count: afterOrders }] = (await sql`SELECT COUNT(*)::int AS count FROM orders`) as Array<{ count: number }>;
  const [{ count: afterPositions }] = (await sql`SELECT COUNT(*)::int AS count FROM user_positions`) as Array<{ count: number }>;
  const [{ count: afterDaily }] = (await sql`SELECT COUNT(*)::int AS count FROM daily_markets`) as Array<{ count: number }>;

  console.log(`[delete-all-markets] After:  markets=${afterMarkets} trades=${afterTrades} orders=${afterOrders} positions=${afterPositions} daily_markets=${afterDaily}`);
  console.log("[delete-all-markets] Done.");

  await sql.end();
}

main().catch(async (err) => {
  console.error("[delete-all-markets] Failed:", err);
  try {
    await sql.end();
  } catch {}
  process.exit(1);
});
