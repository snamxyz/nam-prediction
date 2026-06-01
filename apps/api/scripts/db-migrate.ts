/**
 * Production-safe Drizzle migration runner.
 *
 * drizzle-kit migrate fails when push-schema or a prior partial deploy already
 * created columns/tables that a generated migration tries to add again without
 * IF NOT EXISTS. This runner applies journal migrations idempotently and records
 * them in drizzle.__drizzle_migrations the same way drizzle-kit does.
 */
import postgres from "postgres";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[db-migrate] DATABASE_URL is required");
  process.exit(1);
}

const migrationsFolder = join(import.meta.dir, "..", "drizzle");
const journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf-8"),
) as {
  entries: { when: number; tag: string; breakpoints: boolean }[];
};

function makeIdempotent(sql: string): string {
  return sql
    .replace(/ADD COLUMN (?!IF NOT EXISTS)(")/gi, "ADD COLUMN IF NOT EXISTS $1")
    .replace(/CREATE TABLE (?!IF NOT EXISTS)(")/gi, "CREATE TABLE IF NOT EXISTS $1")
    .replace(
      /CREATE UNIQUE INDEX (?!IF NOT EXISTS)(")/gi,
      "CREATE UNIQUE INDEX IF NOT EXISTS $1",
    )
    .replace(/CREATE INDEX (?!IF NOT EXISTS)(")/gi, "CREATE INDEX IF NOT EXISTS $1");
}

function splitStatements(content: string, breakpoints: boolean): string[] {
  if (breakpoints && content.includes("--> statement-breakpoint")) {
    return content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
  }
  return [content.trim()].filter(Boolean);
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const rows = await sql<{ created_at: string | null }[]>`
    SELECT created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const lastWhen = rows[0]?.created_at ? Number(rows[0].created_at) : 0;
  console.log(
    `[db-migrate] Last applied migration timestamp: ${lastWhen || "none"}`,
  );

  for (const entry of journal.entries) {
    if (entry.when <= lastWhen) {
      console.log(`[db-migrate] Skip ${entry.tag} (already applied)`);
      continue;
    }

    const filePath = join(migrationsFolder, `${entry.tag}.sql`);
    if (!existsSync(filePath)) {
      throw new Error(`Missing migration file: ${filePath}`);
    }

    const raw = readFileSync(filePath, "utf-8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const statements = splitStatements(raw, entry.breakpoints).map(makeIdempotent);

    console.log(
      `[db-migrate] Applying ${entry.tag} (${statements.length} statement(s))...`,
    );

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry.when})
      `;
    });

    console.log(`[db-migrate] Applied ${entry.tag}`);
  }

  console.log("[db-migrate] All migrations up to date");
} catch (err) {
  console.error("[db-migrate] Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
