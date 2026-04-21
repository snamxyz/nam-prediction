import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  real,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Markets ───
export const markets = pgTable(
  "markets",
  {
    id: serial("id").primaryKey(),
    onChainId: integer("on_chain_id").notNull().unique(),
    question: text("question").notNull(),
    yesToken: text("yes_token").notNull(),
    noToken: text("no_token").notNull(),
    ammAddress: text("amm_address").notNull(),
    executionMode: text("execution_mode").notNull().default("amm"), // amm | clob
    cadence: text("cadence").notNull().default("daily"), // daily | 24h (resolves 00:00 ET)
    status: text("status").notNull().default("open"), // created | open | locked | resolving | resolved | cancelled
    lockTime: timestamp("lock_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    resolved: boolean("resolved").notNull().default(false),
    result: integer("result").notNull().default(0), // 0=unresolved, 1=YES, 2=NO
    yesPrice: real("yes_price").notNull().default(0.5),
    noPrice: real("no_price").notNull().default(0.5),
    volume: numeric("volume", { precision: 30, scale: 6 }).notNull().default("0"),
    liquidity: numeric("liquidity", { precision: 30, scale: 6 }).notNull().default("0"),
    resolutionSource: text("resolution_source").notNull().default("admin"), // admin | api | dexscreener | uma
    resolutionConfig: jsonb("resolution_config"), // source-specific JSON config
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("markets_status_end_time_idx").on(table.status, table.endTime),
    index("markets_execution_status_idx").on(table.executionMode, table.status),
  ]
);

// ─── Trades ───
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    trader: text("trader").notNull(),
    isYes: boolean("is_yes").notNull(),
    isBuy: boolean("is_buy").notNull(),
    shares: numeric("shares", { precision: 30, scale: 18 }).notNull(),
    collateral: numeric("collateral", { precision: 30, scale: 6 }).notNull(),
    // AMM-implied YES/NO probabilities captured right after the trade,
    // so the price chart and the market header share one source of truth.
    yesPrice: real("yes_price").notNull().default(0.5),
    noPrice: real("no_price").notNull().default(0.5),
    txHash: text("tx_hash").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("trades_market_timestamp_idx").on(table.marketId, table.timestamp),
    // Unique per (market, txHash) — guards the SELECT-then-INSERT race in
    // processTradeFill that used to let concurrent fills double-credit a
    // user's position.
    uniqueIndex("trades_market_tx_hash_idx").on(table.marketId, table.txHash),
    index("trades_trader_timestamp_idx").on(table.trader, table.timestamp),
  ]
);

// ─── User Positions ───
export const userPositions = pgTable(
  "user_positions",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    userAddress: text("user_address").notNull(),
    yesBalance: numeric("yes_balance", { precision: 30, scale: 18 }).notNull().default("0"),
    noBalance: numeric("no_balance", { precision: 30, scale: 18 }).notNull().default("0"),
    // Kept for backward compat; new code uses yes/noAvgPrice + cost bases.
    avgEntryPrice: real("avg_entry_price").notNull().default(0),
    pnl: numeric("pnl", { precision: 30, scale: 6 }).notNull().default("0"),
    // Per-side tracking so the portfolio can show an accurate avg price and
    // PnL for users who hold BOTH YES and NO on the same market.
    yesAvgPrice: real("yes_avg_price").notNull().default(0),
    noAvgPrice: real("no_avg_price").notNull().default(0),
    yesCostBasis: numeric("yes_cost_basis", { precision: 30, scale: 6 }).notNull().default("0"),
    noCostBasis: numeric("no_cost_basis", { precision: 30, scale: 6 }).notNull().default("0"),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("user_market_idx").on(table.marketId, table.userAddress),
    index("positions_user_market_idx").on(table.userAddress, table.marketId),
  ]
);

// ─── CLOB balances ───
export const balances = pgTable(
  "balances",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    asset: text("asset").notNull().default("USDC"),
    available: numeric("available", { precision: 30, scale: 18 }).notNull().default("0"),
    locked: numeric("locked", { precision: 30, scale: 18 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("balances_user_asset_idx").on(table.userAddress, table.asset),
    index("balances_user_idx").on(table.userAddress),
  ]
);

// ─── CLOB holdings by market ───
export const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    userAddress: text("user_address").notNull(),
    yesAvailable: numeric("yes_available", { precision: 30, scale: 18 }).notNull().default("0"),
    yesLocked: numeric("yes_locked", { precision: 30, scale: 18 }).notNull().default("0"),
    noAvailable: numeric("no_available", { precision: 30, scale: 18 }).notNull().default("0"),
    noLocked: numeric("no_locked", { precision: 30, scale: 18 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("holdings_user_market_idx").on(table.marketId, table.userAddress),
    index("holdings_user_idx").on(table.userAddress),
  ]
);

// ─── Orders (CLOB lifecycle) ───
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id").notNull(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    userAddress: text("user_address").notNull(),
    side: text("side").notNull(), // buy | sell
    outcome: text("outcome").notNull(), // yes | no
    orderType: text("order_type").notNull().default("limit"), // limit | market
    price: numeric("price", { precision: 12, scale: 6 }).notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 18 }).notNull(),
    filledQuantity: numeric("filled_quantity", { precision: 30, scale: 18 }).notNull().default("0"),
    remainingQuantity: numeric("remaining_quantity", { precision: 30, scale: 18 }).notNull(),
    status: text("status").notNull().default("open"),
    clientOrderId: text("client_order_id"),
    signature: text("signature"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_order_id_idx").on(table.orderId),
    index("orders_market_status_created_idx").on(table.marketId, table.status, table.createdAt),
    index("orders_user_status_created_idx").on(table.userAddress, table.status, table.createdAt),
    index("orders_market_outcome_side_price_idx").on(table.marketId, table.outcome, table.side, table.price),
  ]
);

// ─── Settlement batches ───
export const settlements = pgTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    settlementId: text("settlement_id").notNull(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    status: text("status").notNull().default("pending"), // pending | submitted | confirmed | failed
    fillsCount: integer("fills_count").notNull().default(0),
    totalQuantity: numeric("total_quantity", { precision: 30, scale: 18 }).notNull().default("0"),
    totalNotional: numeric("total_notional", { precision: 30, scale: 6 }).notNull().default("0"),
    txHash: text("tx_hash"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("settlements_settlement_id_idx").on(table.settlementId),
    uniqueIndex("settlements_tx_hash_idx").on(table.txHash),
    index("settlements_market_status_created_idx").on(table.marketId, table.status, table.createdAt),
  ]
);

// ─── CLOB fills ───
export const orderFills = pgTable(
  "order_fills",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    makerOrderId: integer("maker_order_id")
      .notNull()
      .references(() => orders.id),
    takerOrderId: integer("taker_order_id")
      .notNull()
      .references(() => orders.id),
    makerAddress: text("maker_address").notNull(),
    takerAddress: text("taker_address").notNull(),
    outcome: text("outcome").notNull(),
    price: numeric("price", { precision: 12, scale: 6 }).notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 18 }).notNull(),
    makerFee: numeric("maker_fee", { precision: 30, scale: 6 }).notNull().default("0"),
    takerFee: numeric("taker_fee", { precision: 30, scale: 6 }).notNull().default("0"),
    settled: boolean("settled").notNull().default(false),
    settlementId: integer("settlement_id").references(() => settlements.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("order_fills_market_created_idx").on(table.marketId, table.createdAt),
    index("order_fills_settlement_idx").on(table.settlementId),
    index("order_fills_maker_taker_idx").on(table.makerAddress, table.takerAddress),
  ]
);

// ─── Internal Metrics ───
export const internalMetrics = pgTable("internal_metrics", {
  id: serial("id").primaryKey(),
  metricName: text("metric_name").notNull().unique(),
  value: numeric("value", { precision: 30, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Users (Privy auth) ───
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyUserId: text("privy_user_id").notNull().unique(),
  walletAddress: text("wallet_address"),
  displayName: text("display_name"),
  loginMethod: text("login_method"), // wallet | twitter | google | email
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Vault Transactions (deposit / withdraw history) ───
export const vaultTransactions = pgTable(
  "vault_transactions",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    type: text("type").notNull(), // deposit | withdraw
    amount: numeric("amount", { precision: 30, scale: 6 }).notNull(),
    txHash: text("tx_hash").notNull(),
    blockNumber: numeric("block_number", { precision: 30, scale: 0 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("vault_tx_hash_idx").on(table.txHash),
    index("vault_tx_user_timestamp_idx").on(table.userAddress, table.timestamp),
    index("vault_tx_type_timestamp_idx").on(table.type, table.timestamp),
  ]
);

// ─── Daily Markets (rolling NAM price markets) ───
export const dailyMarkets = pgTable("daily_markets", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").references(() => markets.id),
  date: text("date").notNull().unique(), // YYYY-MM-DD resolution date
  threshold: numeric("threshold", { precision: 30, scale: 10 }).notNull(),
  settlementPrice: numeric("settlement_price", { precision: 30, scale: 10 }),
  status: text("status").notNull().default("active"), // active | resolved | creating
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── DEX token pairs ───
export const tokenPairs = pgTable(
  "token_pairs",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    pairAddress: text("pair_address").notNull(),
    baseSymbol: text("base_symbol").notNull(),
    quoteSymbol: text("quote_symbol").notNull().default("USDC"),
    source: text("source").notNull().default("dexscreener"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("token_pairs_pair_address_idx").on(table.pairAddress),
    index("token_pairs_chain_active_idx").on(table.chainId, table.active),
  ]
);

// ─── Price snapshots ───
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: serial("id").primaryKey(),
    pairAddress: text("pair_address").notNull(),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }).notNull(),
    liquidityUsd: numeric("liquidity_usd", { precision: 30, scale: 6 }),
    volume24hUsd: numeric("volume_24h_usd", { precision: 30, scale: 6 }),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    stale: boolean("stale").notNull().default(false),
    anomalyScore: real("anomaly_score").notNull().default(0),
  },
  (table) => [
    index("price_snapshots_pair_timestamp_idx").on(table.pairAddress, table.timestamp),
    index("price_snapshots_timestamp_idx").on(table.timestamp),
  ]
);

// ─── Liquidity snapshots ───
export const liquiditySnapshots = pgTable(
  "liquidity_snapshots",
  {
    id: serial("id").primaryKey(),
    pairAddress: text("pair_address").notNull(),
    liquidityUsd: numeric("liquidity_usd", { precision: 30, scale: 6 }).notNull(),
    baseLiquidity: numeric("base_liquidity", { precision: 30, scale: 18 }),
    quoteLiquidity: numeric("quote_liquidity", { precision: 30, scale: 18 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("liquidity_snapshots_pair_timestamp_idx").on(table.pairAddress, table.timestamp),
  ]
);

// ─── Resolution logs ───
export const resolutionLogs = pgTable(
  "resolution_logs",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.id),
    pairAddress: text("pair_address"),
    policy: text("policy").notNull().default("lock_time_last_valid"),
    lockTime: timestamp("lock_time", { withTimezone: true }).notNull(),
    resolvedPrice: numeric("resolved_price", { precision: 30, scale: 12 }),
    outcome: integer("outcome"),
    sourceSnapshotId: integer("source_snapshot_id").references(() => priceSnapshots.id),
    status: text("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("resolution_logs_market_created_idx").on(table.marketId, table.createdAt),
    index("resolution_logs_status_created_idx").on(table.status, table.createdAt),
  ]
);

// ─── Risk events ───
export const riskEvents = pgTable(
  "risk_events",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id").references(() => markets.id),
    userAddress: text("user_address"),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().default("warning"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("risk_events_market_created_idx").on(table.marketId, table.createdAt),
    index("risk_events_type_severity_idx").on(table.eventType, table.severity),
    index("risk_events_user_created_idx").on(table.userAddress, table.createdAt),
  ]
);

// ─── Type exports ───
export type MarketRow = typeof markets.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type UserPositionRow = typeof userPositions.$inferSelect;
export type InternalMetricRow = typeof internalMetrics.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type DailyMarketRow = typeof dailyMarkets.$inferSelect;
export type BalanceRow = typeof balances.$inferSelect;
export type HoldingRow = typeof holdings.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderFillRow = typeof orderFills.$inferSelect;
export type SettlementRow = typeof settlements.$inferSelect;
export type TokenPairRow = typeof tokenPairs.$inferSelect;
export type PriceSnapshotRow = typeof priceSnapshots.$inferSelect;
export type LiquiditySnapshotRow = typeof liquiditySnapshots.$inferSelect;
export type ResolutionLogRow = typeof resolutionLogs.$inferSelect;
export type RiskEventRow = typeof riskEvents.$inferSelect;
export type VaultTransactionRow = typeof vaultTransactions.$inferSelect;
