-- Phase 4: persist Vault.Deposit / Vault.Withdraw events so users can see
-- their full deposit / withdrawal history and operators can audit TVL flow.

CREATE TABLE IF NOT EXISTS "vault_transactions" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_address"  text           NOT NULL,
  "type"          text           NOT NULL,
  "amount"        numeric(30, 6) NOT NULL,
  "tx_hash"       text           NOT NULL,
  "block_number"  numeric(30, 0),
  "timestamp"     timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vault_tx_hash_idx"
  ON "vault_transactions" ("tx_hash");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_tx_user_timestamp_idx"
  ON "vault_transactions" ("user_address", "timestamp");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_tx_type_timestamp_idx"
  ON "vault_transactions" ("type", "timestamp");
