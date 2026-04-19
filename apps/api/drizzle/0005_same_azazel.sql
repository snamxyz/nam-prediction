CREATE TABLE "vault_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(30, 6) NOT NULL,
	"tx_hash" text NOT NULL,
	"block_number" numeric(30, 0),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "yes_avg_price" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "no_avg_price" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "yes_cost_basis" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "no_cost_basis" numeric(30, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_positions" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_tx_hash_idx" ON "vault_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "vault_tx_user_timestamp_idx" ON "vault_transactions" USING btree ("user_address","timestamp");--> statement-breakpoint
CREATE INDEX "vault_tx_type_timestamp_idx" ON "vault_transactions" USING btree ("type","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_market_tx_hash_idx" ON "trades" USING btree ("market_id","tx_hash");--> statement-breakpoint
CREATE INDEX "trades_trader_timestamp_idx" ON "trades" USING btree ("trader","timestamp");