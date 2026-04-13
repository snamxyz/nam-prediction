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
  end_time TIMESTAMPTZ NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  result INTEGER NOT NULL DEFAULT 0,
  yes_price REAL NOT NULL DEFAULT 0.5,
  no_price REAL NOT NULL DEFAULT 0.5,
  volume NUMERIC(30,6) NOT NULL DEFAULT '0',
  liquidity NUMERIC(30,6) NOT NULL DEFAULT '0',
  resolution_source TEXT NOT NULL DEFAULT 'admin',
  resolution_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trades
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  trader TEXT NOT NULL,
  is_yes BOOLEAN NOT NULL,
  is_buy BOOLEAN NOT NULL,
  shares NUMERIC(30,18) NOT NULL,
  collateral NUMERIC(30,6) NOT NULL,
  tx_hash TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Positions
CREATE TABLE IF NOT EXISTS user_positions (
  id SERIAL PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  user_address TEXT NOT NULL,
  yes_balance NUMERIC(30,18) NOT NULL DEFAULT '0',
  no_balance NUMERIC(30,18) NOT NULL DEFAULT '0',
  avg_entry_price REAL NOT NULL DEFAULT 0,
  pnl NUMERIC(30,6) NOT NULL DEFAULT '0'
);
CREATE UNIQUE INDEX IF NOT EXISTS user_market_idx ON user_positions(market_id, user_address);

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
`;

try {
  await sql.unsafe(ddl);
  console.log("✅ All 6 tables created successfully");
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
