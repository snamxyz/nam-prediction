ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "ending_liquidity" numeric(30, 6);
--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN IF NOT EXISTS "ending_liquidity" numeric(30, 6);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_fee_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "market_family" text NOT NULL,
  "market_id" integer NOT NULL,
  "pool_address" text,
  "trader" text NOT NULL,
  "amount" numeric(30, 6) NOT NULL,
  "is_buy" boolean,
  "is_yes" boolean,
  "range_index" integer,
  "tx_hash" text NOT NULL,
  "log_index" integer DEFAULT 0 NOT NULL,
  "block_number" numeric(30, 0),
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_fee_events_tx_log_idx" ON "market_fee_events" ("tx_hash", "log_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_fee_events_family_market_idx" ON "market_fee_events" ("market_family", "market_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_fee_events_timestamp_idx" ON "market_fee_events" ("timestamp");
--> statement-breakpoint
INSERT INTO "market_fee_events" (
  "market_family",
  "market_id",
  "pool_address",
  "trader",
  "amount",
  "is_buy",
  "tx_hash",
  "log_index",
  "timestamp"
)
SELECT
  'clob',
  "market_id",
  NULL,
  "taker_address",
  ("maker_fee"::numeric + "taker_fee"::numeric),
  NULL,
  'clob-fill-' || "id"::text,
  0,
  "created_at"
FROM "order_fills"
WHERE ("maker_fee"::numeric + "taker_fee"::numeric) > 0
ON CONFLICT ("tx_hash", "log_index") DO NOTHING;
