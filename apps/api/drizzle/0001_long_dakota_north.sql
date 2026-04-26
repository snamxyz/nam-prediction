CREATE TABLE "range_markets" (
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
--> statement-breakpoint
CREATE TABLE "range_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"range_market_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"range_index" integer NOT NULL,
	"balance" numeric(30, 18) DEFAULT '0' NOT NULL,
	"avg_entry_price" real DEFAULT 0 NOT NULL,
	"cost_basis" numeric(30, 6) DEFAULT '0' NOT NULL,
	"pnl" numeric(30, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "range_trades" (
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
--> statement-breakpoint
ALTER TABLE "range_positions" ADD CONSTRAINT "range_positions_range_market_id_range_markets_id_fk" FOREIGN KEY ("range_market_id") REFERENCES "public"."range_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "range_trades" ADD CONSTRAINT "range_trades_range_market_id_range_markets_id_fk" FOREIGN KEY ("range_market_id") REFERENCES "public"."range_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "range_markets_type_status_idx" ON "range_markets" USING btree ("market_type","status");--> statement-breakpoint
CREATE INDEX "range_markets_end_time_idx" ON "range_markets" USING btree ("end_time");--> statement-breakpoint
CREATE INDEX "range_markets_type_date_idx" ON "range_markets" USING btree ("market_type","date");--> statement-breakpoint
CREATE UNIQUE INDEX "range_positions_market_user_range_idx" ON "range_positions" USING btree ("range_market_id","user_address","range_index");--> statement-breakpoint
CREATE INDEX "range_positions_user_market_idx" ON "range_positions" USING btree ("user_address","range_market_id");--> statement-breakpoint
CREATE INDEX "range_trades_market_timestamp_idx" ON "range_trades" USING btree ("range_market_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "range_trades_market_tx_hash_idx" ON "range_trades" USING btree ("range_market_id","tx_hash");--> statement-breakpoint
CREATE INDEX "range_trades_trader_timestamp_idx" ON "range_trades" USING btree ("trader","timestamp");