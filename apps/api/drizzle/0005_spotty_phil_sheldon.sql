CREATE TABLE "market_fee_events" (
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
ALTER TABLE "markets" ADD COLUMN "seeded_liquidity" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "ending_liquidity" numeric(30, 6);--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN "ending_liquidity" numeric(30, 6);--> statement-breakpoint
CREATE UNIQUE INDEX "market_fee_events_tx_log_idx" ON "market_fee_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "market_fee_events_family_market_idx" ON "market_fee_events" USING btree ("market_family","market_id");--> statement-breakpoint
CREATE INDEX "market_fee_events_timestamp_idx" ON "market_fee_events" USING btree ("timestamp");