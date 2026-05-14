import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Neon Postgres client. The Vercel-Neon integration provisions DATABASE_URL.
 * `@vercel/postgres` is deprecated — `@neondatabase/serverless` is the
 * recommended driver and is what gets injected by the Marketplace install.
 */
let cached: NeonQueryFunction<false, false> | null = null;

function client(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cached = neon(url);
  return cached;
}

/** Run a tagged-template SQL query. Use as `sql\`SELECT ... ${val}\``. */
export function sql(...args: Parameters<NeonQueryFunction<false, false>>) {
  return client()(...args);
}

let schemaInitialized = false;

/**
 * Idempotent schema bootstrap. Called by routes that touch the DB before
 * first read/write. Cheap on warm Lambda (one-line check), no-op on cold
 * after the first call.
 *
 * The columns mirror the SalesSummary shape — adding columns later is easy
 * (ALTER TABLE ... ADD COLUMN ... IF NOT EXISTS), but renaming is annoying,
 * so the names match the user-supplied spec exactly.
 */
export async function initSchema(): Promise<void> {
  if (schemaInitialized) return;
  const c = client();

  await c`
    CREATE TABLE IF NOT EXISTS snapshots (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL UNIQUE,
      active_count INTEGER NOT NULL,
      services_count INTEGER NOT NULL,
      new_count INTEGER NOT NULL,
      returning_count INTEGER NOT NULL,
      retained_count INTEGER NOT NULL,
      retained_auto INTEGER NOT NULL,
      retained_seb INTEGER NOT NULL,
      retained_eb INTEGER NOT NULL,
      at_risk_count INTEGER NOT NULL,
      cancelled_count INTEGER NOT NULL,
      cancelled_2026 INTEGER NOT NULL DEFAULT 0,
      cancelled_2025 INTEGER NOT NULL DEFAULT 0,
      cancelled_2024 INTEGER NOT NULL DEFAULT 0,
      cancelled_2023 INTEGER NOT NULL DEFAULT 0,
      cancelled_2022 INTEGER NOT NULL DEFAULT 0,
      cancelled_2021 INTEGER NOT NULL DEFAULT 0,
      on_hold_count INTEGER NOT NULL,
      untagged_count INTEGER NOT NULL,
      raw_json JSONB NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS snapshots_snapshot_date_idx ON snapshots(snapshot_date DESC)`;

  await c`
    CREATE TABLE IF NOT EXISTS customers (
      pocomos_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      full_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      zip TEXT,
      date_created TEXT,
      last_service_date TEXT,
      next_service_date TEXT,
      cancel_date TEXT,
      sales_status TEXT,
      marketing_type TEXT,
      depth TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      contracts JSONB NOT NULL DEFAULT '[]'::jsonb,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS customers_status_idx ON customers(status)`;
  await c`CREATE INDEX IF NOT EXISTS customers_last_service_date_idx ON customers(last_service_date)`;
  await c`CREATE INDEX IF NOT EXISTS customers_refreshed_at_idx ON customers(refreshed_at DESC)`;

  schemaInitialized = true;
}
