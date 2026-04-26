/**
 * Run the range-markets migration using the same postgres.js driver as the API.
 * Usage: bun run scripts/migrate-range.ts
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const sql = postgres(DATABASE_URL, { max: 1 });

const migration = `
CREATE TABLE IF NOT EXISTS "range_markets" (
  "id" serial PRIMARY KEY NOT NULL,
  "market_type" text NOT NULL,
  "date" text NOT NULL,
  "question" text NOT NULL,
  "ranges" jsonb NOT NULL,
  "range_token_addresses" jsonb NOT NULL,
  "range_prices" jsonb NOT NULL,
  "range_cpmm_address" text,
  "on_chain_market_id" integer,
  "total_liquidity" numeric(30, 6) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'creating' NOT NULL,
  "resolved" boolean DEFAULT false NOT NULL,
  "winning_range_index" integer,
  "end_time" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "range_positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "range_market_id" integer NOT NULL,
  "user_address" text NOT NULL,
  "range_index" integer NOT NULL,
  "balance" numeric(30, 18) DEFAULT '0' NOT NULL,
  "avg_entry_price" real DEFAULT 0 NOT NULL,
  "cost_basis" numeric(30, 6) DEFAULT '0' NOT NULL,
  "pnl" numeric(30, 6) DEFAULT '0' NOT NULL
);

CREATE TABLE IF NOT EXISTS "range_trades" (
  "id" serial PRIMARY KEY NOT NULL,
  "range_market_id" integer NOT NULL,
  "trader" text NOT NULL,
  "range_index" integer NOT NULL,
  "is_buy" boolean NOT NULL,
  "shares" numeric(30, 18) NOT NULL,
  "collateral" numeric(30, 6) NOT NULL,
  "prices_snapshot" jsonb,
  "tx_hash" text NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "range_positions"
    ADD CONSTRAINT "range_positions_range_market_id_range_markets_id_fk"
    FOREIGN KEY ("range_market_id") REFERENCES "range_markets"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "range_trades"
    ADD CONSTRAINT "range_trades_range_market_id_range_markets_id_fk"
    FOREIGN KEY ("range_market_id") REFERENCES "range_markets"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "range_markets_type_status_idx"
  ON "range_markets" USING btree ("market_type", "status");

CREATE INDEX IF NOT EXISTS "range_markets_end_time_idx"
  ON "range_markets" USING btree ("end_time");

CREATE INDEX IF NOT EXISTS "range_markets_type_date_idx"
  ON "range_markets" USING btree ("market_type", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "range_positions_market_user_range_idx"
  ON "range_positions" USING btree ("range_market_id", "user_address", "range_index");

CREATE INDEX IF NOT EXISTS "range_positions_user_market_idx"
  ON "range_positions" USING btree ("user_address", "range_market_id");

CREATE INDEX IF NOT EXISTS "range_trades_market_timestamp_idx"
  ON "range_trades" USING btree ("range_market_id", "timestamp");

CREATE UNIQUE INDEX IF NOT EXISTS "range_trades_market_tx_hash_idx"
  ON "range_trades" USING btree ("range_market_id", "tx_hash");

CREATE INDEX IF NOT EXISTS "range_trades_trader_timestamp_idx"
  ON "range_trades" USING btree ("trader", "timestamp");
`;

async function main() {
  console.log("[migrate-range] Connecting to database...");
  try {
    await sql.unsafe(migration);
    console.log("[migrate-range] ✓ range_markets, range_positions, range_trades tables created (or already exist).");
  } catch (err) {
    console.error("[migrate-range] ✗ Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
