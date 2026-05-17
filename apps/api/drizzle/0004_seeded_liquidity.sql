ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "seeded_liquidity" numeric(30, 6) DEFAULT '0' NOT NULL;

-- Backfill from existing liquidity where it was set at creation.
UPDATE "markets"
SET "seeded_liquidity" = "liquidity"
WHERE "seeded_liquidity" = '0' AND "liquidity"::numeric > 0;

-- 24h markets that lost seed to indexer race (liquidity still 0).
UPDATE "markets"
SET "seeded_liquidity" = '1'
WHERE "seeded_liquidity" = '0' AND "cadence" = '24h';

-- Daily binary markets default seed.
UPDATE "markets"
SET "seeded_liquidity" = '100'
WHERE "seeded_liquidity" = '0' AND "cadence" = 'daily';

-- Drained markets: reconstruct seed from treasury return + reserved claims.
UPDATE "markets"
SET "seeded_liquidity" = ("liquidity_withdrawn"::numeric + "outstanding_winning_claims"::numeric)
WHERE "seeded_liquidity" = '0'
  AND "liquidity_drained" = true
  AND ("liquidity_withdrawn"::numeric + "outstanding_winning_claims"::numeric) > 0;
