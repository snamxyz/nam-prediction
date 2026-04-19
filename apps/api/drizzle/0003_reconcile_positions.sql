-- Phase 1: share-balance accuracy
--
-- 1. Back-fill a dedupe key on trades so concurrent processTradeFill calls
--    can't double-credit positions via a SELECT-then-INSERT race.
-- 2. Extend user_positions with per-side avg-price + cost-basis tracking so
--    a user holding BOTH YES and NO gets a correct avg price and live PnL
--    for each leg. Also stamps the last reconciler pass for observability.

-- Before we add the unique index, drop any duplicate (market_id, tx_hash)
-- rows that may have been introduced by the race we're patching. Keep the
-- oldest row (lowest id) for each duplicate group.
DELETE FROM "trades" t
USING "trades" older
WHERE t.market_id = older.market_id
  AND t.tx_hash   = older.tx_hash
  AND t.id        > older.id;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trades_market_tx_hash_idx"
  ON "trades" ("market_id", "tx_hash");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_trader_timestamp_idx"
  ON "trades" ("trader", "timestamp");

--> statement-breakpoint
ALTER TABLE "user_positions"
  ADD COLUMN IF NOT EXISTS "yes_avg_price"   real               NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "no_avg_price"    real               NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "yes_cost_basis"  numeric(30, 6)     NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "no_cost_basis"   numeric(30, 6)     NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "last_reconciled_at" timestamptz;
