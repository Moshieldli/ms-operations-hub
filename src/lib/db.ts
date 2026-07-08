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

  await c`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Mosquito service-status report (/service/overdue). One row per eligible
  // Active customer with an active mosquito contract. Populated by the scrape
  // job (lib/service/refresh.ts) — the page reads this table instantly, it
  // never scrapes on load. `status`: 'overdue' | 'current' | 'needs_check'.
  await c`
    CREATE TABLE IF NOT EXISTS mosquito_service_status (
      pocomos_id TEXT PRIMARY KEY,
      full_name TEXT,
      mosquito_contract_type TEXT,
      selected_contract_label TEXT,
      last_regular_spray DATE,
      days_since INTEGER,
      status TEXT NOT NULL,
      reason TEXT,
      sign_up_date DATE,
      open_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
      next_service_date DATE,
      is_weekly BOOLEAN NOT NULL DEFAULT FALSE,
      route_code TEXT,
      last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS mosquito_service_status_status_idx ON mosquito_service_status(status)`;
  await c`CREATE INDEX IF NOT EXISTS mosquito_service_status_days_since_idx ON mosquito_service_status(days_since DESC)`;
  await c`CREATE INDEX IF NOT EXISTS mosquito_service_status_checked_idx ON mosquito_service_status(last_checked_at)`;
  // Added 2026-06-12 (sign-up date + open-balance / paused-account buckets).
  // Cover environments where the table predates these columns.
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS sign_up_date DATE`;
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS open_balance NUMERIC(10,2) NOT NULL DEFAULT 0`;
  // Added 2026-06-14 (next-scheduled-service column + weekly-cadence pill).
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS next_service_date DATE`;
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS is_weekly BOOLEAN NOT NULL DEFAULT FALSE`;
  // Added 2026-07-07 (route code scraped from service-information "Routing" widget).
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS route_code TEXT`;

  // Leads close-rate report cache (/leads). Singleton row (id=1) holding the
  // latest computed report for the default period, so the tab paints fast.
  // Custom date ranges are computed live and not cached. Mirrors the
  // snapshot/refresh pattern used elsewhere.
  await c`
    CREATE TABLE IF NOT EXISTS leads_close_rate (
      id INTEGER PRIMARY KEY,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      report JSONB NOT NULL,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await c`
    CREATE TABLE IF NOT EXISTS phoneburner_contacts (
      pocomos_id TEXT PRIMARY KEY,
      pocomos_type TEXT NOT NULL CHECK (pocomos_type IN ('lead', 'customer')),
      pb_contact_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_updated_at TIMESTAMPTZ,
      last_notes_refresh_at TIMESTAMPTZ
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS phoneburner_contacts_folder_idx ON phoneburner_contacts(folder_id)`;
  await c`CREATE INDEX IF NOT EXISTS phoneburner_contacts_pb_id_idx ON phoneburner_contacts(pb_contact_id)`;
  // Backfill the column on environments where the table predates rev 3.
  await c`ALTER TABLE phoneburner_contacts ADD COLUMN IF NOT EXISTS last_notes_refresh_at TIMESTAMPTZ`;

  await c`
    CREATE TABLE IF NOT EXISTS webhook_log (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      pocomos_id TEXT,
      pb_contact_id TEXT,
      disposition TEXT,
      csr_name TEXT,
      note_written BOOLEAN NOT NULL DEFAULT FALSE,
      error TEXT,
      raw_payload JSONB
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS webhook_log_received_at_idx ON webhook_log(received_at DESC)`;
  // Defensive: the column was added after the table; cover environments
  // where the table predates this migration.
  await c`ALTER TABLE webhook_log ADD COLUMN IF NOT EXISTS pb_contact_id TEXT`;

  schemaInitialized = true;
}

/**
 * Read a typed value from the single-row-per-key sync_state table.
 * Returns null when the key doesn't exist. Use to check pre-existence
 * before writing — the value is JSONB so the caller can store any
 * shape (timestamps, watermarks, session blobs).
 */
export async function getSyncState<T = unknown>(key: string): Promise<T | null> {
  const c = client();
  const rows = (await c`SELECT value FROM sync_state WHERE key = ${key}`) as Array<{
    value: T;
  }>;
  return rows.length ? rows[0].value : null;
}

/** Upsert a sync_state row. Caller serializes whatever JSON-able value they want. */
export async function setSyncState(key: string, value: unknown): Promise<void> {
  const c = client();
  await c`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
  `;
}
