CREATE TABLE "daily_markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer,
	"date" text NOT NULL,
	"threshold" numeric(30, 10) NOT NULL,
	"settlement_price" numeric(30, 10),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_markets_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "internal_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_name" text NOT NULL,
	"value" numeric(30, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_metrics_metric_name_unique" UNIQUE("metric_name")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"on_chain_id" integer NOT NULL,
	"question" text NOT NULL,
	"yes_token" text NOT NULL,
	"no_token" text NOT NULL,
	"amm_address" text NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"result" integer DEFAULT 0 NOT NULL,
	"yes_price" real DEFAULT 0.5 NOT NULL,
	"no_price" real DEFAULT 0.5 NOT NULL,
	"volume" numeric(30, 6) DEFAULT '0' NOT NULL,
	"liquidity" numeric(30, 6) DEFAULT '0' NOT NULL,
	"resolution_source" text DEFAULT 'admin' NOT NULL,
	"resolution_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_on_chain_id_unique" UNIQUE("on_chain_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"trader" text NOT NULL,
	"is_yes" boolean NOT NULL,
	"is_buy" boolean NOT NULL,
	"shares" numeric(30, 18) NOT NULL,
	"collateral" numeric(30, 6) NOT NULL,
	"tx_hash" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"yes_balance" numeric(30, 18) DEFAULT '0' NOT NULL,
	"no_balance" numeric(30, 18) DEFAULT '0' NOT NULL,
	"avg_entry_price" real DEFAULT 0 NOT NULL,
	"pnl" numeric(30, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"privy_user_id" text NOT NULL,
	"wallet_address" text,
	"display_name" text,
	"login_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_user_id_unique" UNIQUE("privy_user_id")
);
--> statement-breakpoint
ALTER TABLE "daily_markets" ADD CONSTRAINT "daily_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_market_idx" ON "user_positions" USING btree ("market_id","user_address");