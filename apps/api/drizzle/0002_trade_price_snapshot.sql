ALTER TABLE "trades" ADD COLUMN "yes_price" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "no_price" real DEFAULT 0.5 NOT NULL;
