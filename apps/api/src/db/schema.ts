import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  bigint,
  real,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Markets ───
export const markets = pgTable("markets", {
  id: serial("id").primaryKey(),
  onChainId: integer("on_chain_id").notNull().unique(),
  question: text("question").notNull(),
  yesToken: text("yes_token").notNull(),
  noToken: text("no_token").notNull(),
  ammAddress: text("amm_address").notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  resolved: boolean("resolved").notNull().default(false),
  result: integer("result").notNull().default(0), // 0=unresolved, 1=YES, 2=NO
  yesPrice: real("yes_price").notNull().default(0.5),
  noPrice: real("no_price").notNull().default(0.5),
  volume: numeric("volume", { precision: 30, scale: 6 }).notNull().default("0"),
  liquidity: numeric("liquidity", { precision: 30, scale: 6 }).notNull().default("0"),
  resolutionSource: text("resolution_source").notNull().default("admin"), // admin | api | dexscreener
  resolutionConfig: jsonb("resolution_config"), // source-specific JSON config
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Trades ───
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id")
    .notNull()
    .references(() => markets.id),
  trader: text("trader").notNull(),
  isYes: boolean("is_yes").notNull(),
  isBuy: boolean("is_buy").notNull(),
  shares: numeric("shares", { precision: 30, scale: 18 }).notNull(),
  collateral: numeric("collateral", { precision: 30, scale: 6 }).notNull(),
  txHash: text("tx_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

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
    avgEntryPrice: real("avg_entry_price").notNull().default(0),
    pnl: numeric("pnl", { precision: 30, scale: 6 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("user_market_idx").on(table.marketId, table.userAddress),
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

// ─── Type exports ───
export type MarketRow = typeof markets.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type UserPositionRow = typeof userPositions.$inferSelect;
export type InternalMetricRow = typeof internalMetrics.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type DailyMarketRow = typeof dailyMarkets.$inferSelect;
