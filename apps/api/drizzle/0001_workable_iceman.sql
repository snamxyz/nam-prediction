CREATE TABLE "balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"asset" text DEFAULT 'USDC' NOT NULL,
	"available" numeric(30, 18) DEFAULT '0' NOT NULL,
	"locked" numeric(30, 18) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"yes_available" numeric(30, 18) DEFAULT '0' NOT NULL,
	"yes_locked" numeric(30, 18) DEFAULT '0' NOT NULL,
	"no_available" numeric(30, 18) DEFAULT '0' NOT NULL,
	"no_locked" numeric(30, 18) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair_address" text NOT NULL,
	"liquidity_usd" numeric(30, 6) NOT NULL,
	"base_liquidity" numeric(30, 18),
	"quote_liquidity" numeric(30, 18),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"maker_order_id" integer NOT NULL,
	"taker_order_id" integer NOT NULL,
	"maker_address" text NOT NULL,
	"taker_address" text NOT NULL,
	"outcome" text NOT NULL,
	"price" numeric(12, 6) NOT NULL,
	"quantity" numeric(30, 18) NOT NULL,
	"maker_fee" numeric(30, 6) DEFAULT '0' NOT NULL,
	"taker_fee" numeric(30, 6) DEFAULT '0' NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"settlement_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"market_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"side" text NOT NULL,
	"outcome" text NOT NULL,
	"order_type" text DEFAULT 'limit' NOT NULL,
	"price" numeric(12, 6) NOT NULL,
	"quantity" numeric(30, 18) NOT NULL,
	"filled_quantity" numeric(30, 18) DEFAULT '0' NOT NULL,
	"remaining_quantity" numeric(30, 18) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"client_order_id" text,
	"signature" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair_address" text NOT NULL,
	"price_usd" numeric(30, 12) NOT NULL,
	"liquidity_usd" numeric(30, 6),
	"volume_24h_usd" numeric(30, 6),
	"source_timestamp" timestamp with time zone,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"anomaly_score" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"pair_address" text,
	"policy" text DEFAULT 'lock_time_last_valid' NOT NULL,
	"lock_time" timestamp with time zone NOT NULL,
	"resolved_price" numeric(30, 12),
	"outcome" integer,
	"source_snapshot_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer,
	"user_address" text,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"market_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fills_count" integer DEFAULT 0 NOT NULL,
	"total_quantity" numeric(30, 18) DEFAULT '0' NOT NULL,
	"total_notional" numeric(30, 6) DEFAULT '0' NOT NULL,
	"tx_hash" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "token_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"pair_address" text NOT NULL,
	"base_symbol" text NOT NULL,
	"quote_symbol" text DEFAULT 'USDC' NOT NULL,
	"source" text DEFAULT 'dexscreener' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "execution_mode" text DEFAULT 'amm' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "cadence" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "lock_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fills" ADD CONSTRAINT "order_fills_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fills" ADD CONSTRAINT "order_fills_maker_order_id_orders_id_fk" FOREIGN KEY ("maker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fills" ADD CONSTRAINT "order_fills_taker_order_id_orders_id_fk" FOREIGN KEY ("taker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_fills" ADD CONSTRAINT "order_fills_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_logs" ADD CONSTRAINT "resolution_logs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_logs" ADD CONSTRAINT "resolution_logs_source_snapshot_id_price_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."price_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balances_user_asset_idx" ON "balances" USING btree ("user_address","asset");--> statement-breakpoint
CREATE INDEX "balances_user_idx" ON "balances" USING btree ("user_address");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_user_market_idx" ON "holdings" USING btree ("market_id","user_address");--> statement-breakpoint
CREATE INDEX "holdings_user_idx" ON "holdings" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "liquidity_snapshots_pair_timestamp_idx" ON "liquidity_snapshots" USING btree ("pair_address","timestamp");--> statement-breakpoint
CREATE INDEX "order_fills_market_created_idx" ON "order_fills" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "order_fills_settlement_idx" ON "order_fills" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "order_fills_maker_taker_idx" ON "order_fills" USING btree ("maker_address","taker_address");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_id_idx" ON "orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_market_status_created_idx" ON "orders" USING btree ("market_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_user_status_created_idx" ON "orders" USING btree ("user_address","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_market_outcome_side_price_idx" ON "orders" USING btree ("market_id","outcome","side","price");--> statement-breakpoint
CREATE INDEX "price_snapshots_pair_timestamp_idx" ON "price_snapshots" USING btree ("pair_address","timestamp");--> statement-breakpoint
CREATE INDEX "price_snapshots_timestamp_idx" ON "price_snapshots" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "resolution_logs_market_created_idx" ON "resolution_logs" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "resolution_logs_status_created_idx" ON "resolution_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "risk_events_market_created_idx" ON "risk_events" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_events_type_severity_idx" ON "risk_events" USING btree ("event_type","severity");--> statement-breakpoint
CREATE INDEX "risk_events_user_created_idx" ON "risk_events" USING btree ("user_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_settlement_id_idx" ON "settlements" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_tx_hash_idx" ON "settlements" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "settlements_market_status_created_idx" ON "settlements" USING btree ("market_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "token_pairs_pair_address_idx" ON "token_pairs" USING btree ("pair_address");--> statement-breakpoint
CREATE INDEX "token_pairs_chain_active_idx" ON "token_pairs" USING btree ("chain_id","active");--> statement-breakpoint
CREATE INDEX "markets_status_end_time_idx" ON "markets" USING btree ("status","end_time");--> statement-breakpoint
CREATE INDEX "markets_execution_status_idx" ON "markets" USING btree ("execution_mode","status");--> statement-breakpoint
CREATE INDEX "trades_market_timestamp_idx" ON "trades" USING btree ("market_id","timestamp");--> statement-breakpoint
CREATE INDEX "positions_user_market_idx" ON "user_positions" USING btree ("user_address","market_id");