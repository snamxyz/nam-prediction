/**
 * Add seeded_liquidity column and backfill existing markets.
 * Usage: bun run scripts/migrate-seeded-liquidity.ts
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const sql = postgres(DATABASE_URL, { max: 1 });

const migration = readFileSync(
  join(import.meta.dir, "..", "drizzle", "0004_seeded_liquidity.sql"),
  "utf-8"
);

try {
  await sql.unsafe(migration);
  console.log("[migrate-seeded-liquidity] Applied successfully");
} finally {
  await sql.end();
}
