/**
 * Bun-based schema push — bypasses drizzle-kit (which uses Node.js)
 * since Node.js TCP to Neon is blocked on this machine.
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nam_prediction";

const sql = postgres(DATABASE_URL, { connect_timeout: 15 });

const ddl = `
-- Markets
CREATE TABLE IF NOT EXISTS markets (
  id SERIAL PRIMARY KEY,
  on_chain_id INTEGER NOT NULL UNIQUE,
  question TEXT NOT NULL,
  yes_token TEXT NOT NULL,
  no_token TEXT NOT NULL,
  amm_address TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'amm',
  cadence TEXT NOT NULL DEFAULT 'daily',
  status TEXT NOT NULL DEFAULT 'open',
  lock_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  result INTEGER NOT NULL DEFAULT 0,
  yes_price REAL NOT NULL DEFAULT 0.5,
  no_price REAL NOT NULL DEFAULT 0.5,
  volume NUMERIC(30,6) NOT NULL DEFAULT '0',
  liquidity NUMERIC(30,6) NOT NULL DEFAULT '0',
  resolution_source TEXT NOT NULL DEFAULT 'admin',
  resolution_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE markets ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'amm';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS cadence TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS lock_time TIMESTAMPTZ;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS markets_status_end_time_idx ON markets(status, end_time);
CREATE INDEX IF NOT EXISTS markets_execution_status_idx ON markets(execution_mode, status);

-- Trades (idempotent create; NEVER drop — would blow away price history)
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  trader TEXT NOT NULL,
  is_yes BOOLEAN NOT NULL,
  is_buy BOOLEAN NOT NULL,
  shares NUMERIC(30,18) NOT NULL,
  collateral NUMERIC(30,6) NOT NULL,
  yes_price REAL NOT NULL DEFAULT 0.5,
  no_price REAL NOT NULL DEFAULT 0.5,
  tx_hash TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS yes_price REAL NOT NULL DEFAULT 0.5;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS no_price REAL NOT NULL DEFAULT 0.5;

-- Drop any legacy duplicate rows on (market_id, tx_hash) before we add the
-- unique dedupe index — in case the SELECT-then-INSERT race already landed
-- double-counts in production.
DELETE FROM trades t
USING trades older
WHERE t.market_id = older.market_id
  AND t.tx_hash   = older.tx_hash
  AND t.id        > older.id;

CREATE INDEX IF NOT EXISTS trades_market_timestamp_idx ON trades(market_id, "timestamp");
CREATE INDEX IF NOT EXISTS trades_trader_timestamp_idx ON trades(trader, "timestamp");
CREATE UNIQUE INDEX IF NOT EXISTS trades_market_tx_hash_idx ON trades(market_id, tx_hash);

-- User Positions
CREATE TABLE IF NOT EXISTS user_positions (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  user_address TEXT NOT NULL,
  yes_balance NUMERIC(30,18) NOT NULL DEFAULT '0',
  no_balance NUMERIC(30,18) NOT NULL DEFAULT '0',
  avg_entry_price REAL NOT NULL DEFAULT 0,
  pnl NUMERIC(30,6) NOT NULL DEFAULT '0',
  yes_avg_price REAL NOT NULL DEFAULT 0,
  no_avg_price  REAL NOT NULL DEFAULT 0,
  yes_cost_basis NUMERIC(30,6) NOT NULL DEFAULT '0',
  no_cost_basis  NUMERIC(30,6) NOT NULL DEFAULT '0',
  last_reconciled_at TIMESTAMPTZ
);
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS yes_avg_price REAL NOT NULL DEFAULT 0;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS no_avg_price  REAL NOT NULL DEFAULT 0;
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS yes_cost_basis NUMERIC(30,6) NOT NULL DEFAULT '0';
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS no_cost_basis  NUMERIC(30,6) NOT NULL DEFAULT '0';
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS user_market_idx ON user_positions(market_id, user_address);
CREATE INDEX IF NOT EXISTS positions_user_market_idx ON user_positions(user_address, market_id);

-- Balances
CREATE TABLE IF NOT EXISTS balances (
  id SERIAL PRIMARY KEY,
  user_address TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDC',
  available NUMERIC(30,18) NOT NULL DEFAULT '0',
  locked NUMERIC(30,18) NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS balances_user_asset_idx ON balances(user_address, asset);
CREATE INDEX IF NOT EXISTS balances_user_idx ON balances(user_address);

-- Holdings
CREATE TABLE IF NOT EXISTS holdings (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  user_address TEXT NOT NULL,
  yes_available NUMERIC(30,18) NOT NULL DEFAULT '0',
  yes_locked NUMERIC(30,18) NOT NULL DEFAULT '0',
  no_available NUMERIC(30,18) NOT NULL DEFAULT '0',
  no_locked NUMERIC(30,18) NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS holdings_user_market_idx ON holdings(market_id, user_address);
CREATE INDEX IF NOT EXISTS holdings_user_idx ON holdings(user_address);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  user_address TEXT NOT NULL,
  side TEXT NOT NULL,
  outcome TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'limit',
  price NUMERIC(12,6) NOT NULL,
  quantity NUMERIC(30,18) NOT NULL,
  filled_quantity NUMERIC(30,18) NOT NULL DEFAULT '0',
  remaining_quantity NUMERIC(30,18) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  client_order_id TEXT,
  signature TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'limit';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity NUMERIC(30,18) NOT NULL DEFAULT '0';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS filled_quantity NUMERIC(30,18) NOT NULL DEFAULT '0';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS remaining_quantity NUMERIC(30,18) NOT NULL DEFAULT '0';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
UPDATE orders
SET order_id = COALESCE(order_id, 'legacy_ord_' || id::text)
WHERE order_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_id_idx ON orders(order_id);
CREATE INDEX IF NOT EXISTS orders_market_status_created_idx ON orders(market_id, status, created_at);
CREATE INDEX IF NOT EXISTS orders_user_status_created_idx ON orders(user_address, status, created_at);
CREATE INDEX IF NOT EXISTS orders_market_outcome_side_price_idx ON orders(market_id, outcome, side, price);

-- Settlements
CREATE TABLE IF NOT EXISTS settlements (
  id SERIAL PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  status TEXT NOT NULL DEFAULT 'pending',
  fills_count INTEGER NOT NULL DEFAULT 0,
  total_quantity NUMERIC(30,18) NOT NULL DEFAULT '0',
  total_notional NUMERIC(30,6) NOT NULL DEFAULT '0',
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_settlement_id_idx ON settlements(settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_tx_hash_idx ON settlements(tx_hash);
CREATE INDEX IF NOT EXISTS settlements_market_status_created_idx ON settlements(market_id, status, created_at);

-- Order Fills
CREATE TABLE IF NOT EXISTS order_fills (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  maker_order_id INTEGER NOT NULL REFERENCES orders(id),
  taker_order_id INTEGER NOT NULL REFERENCES orders(id),
  maker_address TEXT NOT NULL,
  taker_address TEXT NOT NULL,
  outcome TEXT NOT NULL,
  price NUMERIC(12,6) NOT NULL,
  quantity NUMERIC(30,18) NOT NULL,
  maker_fee NUMERIC(30,6) NOT NULL DEFAULT '0',
  taker_fee NUMERIC(30,6) NOT NULL DEFAULT '0',
  settled BOOLEAN NOT NULL DEFAULT false,
  settlement_id INTEGER REFERENCES settlements(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_fills_market_created_idx ON order_fills(market_id, created_at);
CREATE INDEX IF NOT EXISTS order_fills_settlement_idx ON order_fills(settlement_id);
CREATE INDEX IF NOT EXISTS order_fills_maker_taker_idx ON order_fills(maker_address, taker_address);

-- Internal Metrics
CREATE TABLE IF NOT EXISTS internal_metrics (
  id SERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL UNIQUE,
  value NUMERIC(30,6) NOT NULL DEFAULT '0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users (Privy auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  privy_user_id TEXT NOT NULL UNIQUE,
  wallet_address TEXT,
  display_name TEXT,
  login_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vault Transactions (deposit / withdraw history)
CREATE TABLE IF NOT EXISTS vault_transactions (
  id SERIAL PRIMARY KEY,
  user_address TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(30,6) NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number NUMERIC(30,0),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vault_tx_hash_idx ON vault_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS vault_tx_user_timestamp_idx ON vault_transactions(user_address, "timestamp");
CREATE INDEX IF NOT EXISTS vault_tx_type_timestamp_idx ON vault_transactions(type, "timestamp");

-- Daily Markets
CREATE TABLE IF NOT EXISTS daily_markets (
  id SERIAL PRIMARY KEY,
  market_id INTEGER REFERENCES markets(id),
  date TEXT NOT NULL UNIQUE,
  threshold NUMERIC(30,10) NOT NULL,
  settlement_price NUMERIC(30,10),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Token Pairs
CREATE TABLE IF NOT EXISTS token_pairs (
  id SERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  pair_address TEXT NOT NULL,
  base_symbol TEXT NOT NULL,
  quote_symbol TEXT NOT NULL DEFAULT 'USDC',
  source TEXT NOT NULL DEFAULT 'dexscreener',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS token_pairs_pair_address_idx ON token_pairs(pair_address);
CREATE INDEX IF NOT EXISTS token_pairs_chain_active_idx ON token_pairs(chain_id, active);

-- Price Snapshots
CREATE TABLE IF NOT EXISTS price_snapshots (
  id SERIAL PRIMARY KEY,
  pair_address TEXT NOT NULL,
  price_usd NUMERIC(30,12) NOT NULL,
  liquidity_usd NUMERIC(30,6),
  volume_24h_usd NUMERIC(30,6),
  source_timestamp TIMESTAMPTZ,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale BOOLEAN NOT NULL DEFAULT false,
  anomaly_score REAL NOT NULL DEFAULT 0
);
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS price_snapshots_pair_timestamp_idx ON price_snapshots(pair_address, "timestamp");
CREATE INDEX IF NOT EXISTS price_snapshots_timestamp_idx ON price_snapshots("timestamp");

-- Liquidity Snapshots
CREATE TABLE IF NOT EXISTS liquidity_snapshots (
  id SERIAL PRIMARY KEY,
  pair_address TEXT NOT NULL,
  liquidity_usd NUMERIC(30,6) NOT NULL,
  base_liquidity NUMERIC(30,18),
  quote_liquidity NUMERIC(30,18),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE liquidity_snapshots ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS liquidity_snapshots_pair_timestamp_idx ON liquidity_snapshots(pair_address, "timestamp");

-- Resolution Logs
CREATE TABLE IF NOT EXISTS resolution_logs (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  pair_address TEXT,
  policy TEXT NOT NULL DEFAULT 'lock_time_last_valid',
  lock_time TIMESTAMPTZ NOT NULL,
  resolved_price NUMERIC(30,12),
  outcome INTEGER,
  source_snapshot_id INTEGER REFERENCES price_snapshots(id),
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resolution_logs_market_created_idx ON resolution_logs(market_id, created_at);
CREATE INDEX IF NOT EXISTS resolution_logs_status_created_idx ON resolution_logs(status, created_at);

-- Risk Events
CREATE TABLE IF NOT EXISTS risk_events (
  id SERIAL PRIMARY KEY,
  market_id INTEGER REFERENCES markets(id),
  user_address TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risk_events_market_created_idx ON risk_events(market_id, created_at);
CREATE INDEX IF NOT EXISTS risk_events_type_severity_idx ON risk_events(event_type, severity);
CREATE INDEX IF NOT EXISTS risk_events_user_created_idx ON risk_events(user_address, created_at);
`;

try {
  await sql.unsafe(ddl);
  console.log("✅ Hybrid schema tables and indexes are up to date");
  // Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log("Tables:", tables.map((t: any) => t.table_name).join(", "));
} catch (e: any) {
  console.error("❌ Error:", e.message);
}

await sql.end();
process.exit(0);
