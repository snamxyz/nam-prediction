ALTER TABLE "range_markets" ADD COLUMN "liquidity_drained" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN "liquidity_withdrawn" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN "reserved_claims" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN "outstanding_winning_claims" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "range_markets" ADD COLUMN "drained_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "range_markets_resolved_drained_idx" ON "range_markets" USING btree ("resolved","liquidity_drained","resolved_at");