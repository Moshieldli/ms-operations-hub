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
      sprays_this_season INTEGER NOT NULL DEFAULT 0,
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
  // Added 2026-07-08 (ASAP-route rescue: an overdue customer with an upcoming job
  // assigned to the "Z-ASAP" route is being caught up — excluded from the count).
  // Scraped from /customer/{id}/scheduled-services for currently-overdue rows only.
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS asap_route BOOLEAN NOT NULL DEFAULT FALSE`;
  // rev 39 — a re-service is BOOKED within ~9 days of a spray but may be
  // performed much later, so a spray isn't "proven clean" while one is pending.
  // Filled by the nightly refresh, scoped to customers whose most recent spray
  // is 8-21 days old (the booking + completion window).
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS pending_reservice BOOLEAN NOT NULL DEFAULT FALSE`;
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS pending_checked_at TIMESTAMPTZ`;
  // Wellness campaign (2026-07-20): COMPLETED mosquito services this season
  // (any type — Regular/Initial/Re-service), aggregated from respray_jobs after
  // each completed-jobs refresh. Drives the 2+-spray feeder eligibility. The
  // main status upserts never touch it, so it persists across refreshes.
  await c`ALTER TABLE mosquito_service_status ADD COLUMN IF NOT EXISTS sprays_this_season INTEGER NOT NULL DEFAULT 0`;

  // ---- In-dashboard feedback / feature requests (rev 42) ----
  // Submitted by staff from the floating bubble on any dashboard page. No auth
  // (internal tool). Image stored as a base64 data URI inline — cheapest path at
  // our volume (a handful of rows/week), no blob store to provision; capped and
  // downscaled client-side before upload.
  await c`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      body TEXT NOT NULL,
      submitter TEXT,
      source_url TEXT,
      image_data_uri TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC)`;
  await c`CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status)`;

  // ---- Balance clearances (rev 55) ----
  // A paused-balance customer whose open balance went >0 → $0 between two
  // Unpaid-Invoices reads = a collected payment. Written by the mosquito
  // refresh (cron + "Refresh now") AND the /finance Collections-Mode check;
  // read by /finance for the cash-register celebration. DISPLAY-ONLY — the hub
  // never touches payments. The per-day unique index is the ring-once guard:
  // poll + visibilitychange + nightly refresh can all see the same clear, but
  // only the first insert lands (ON CONFLICT DO NOTHING).
  await c`
    CREATE TABLE IF NOT EXISTS balance_clearances (
      id BIGSERIAL PRIMARY KEY,
      pocomos_id TEXT NOT NULL,
      full_name TEXT,
      amount_cleared NUMERIC(10,2) NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL
    )
  `;
  // (detected_at AT TIME ZONE 'UTC')::date is immutable (a bare ::date on
  // timestamptz isn't), so it can back the dedupe index.
  await c`
    CREATE UNIQUE INDEX IF NOT EXISTS balance_clearances_day_dedupe
    ON balance_clearances (pocomos_id, ((detected_at AT TIME ZONE 'UTC')::date))
  `;
  await c`CREATE INDEX IF NOT EXISTS balance_clearances_detected_idx ON balance_clearances (detected_at DESC)`;

  // ---- Board announcements (rev 50) ----
  // Editable THIS WEEK / NEXT WEEK natural-vs-synthetic notes for the schedule
  // board's announcements panel. Single-row table (id=1); edited from
  // /service/board. Free text; no PII.
  await c`
    CREATE TABLE IF NOT EXISTS board_announcements (
      id INT PRIMARY KEY DEFAULT 1,
      this_week TEXT NOT NULL DEFAULT '',
      next_week TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ---- Technician roster + compliments / shout-outs (rev 50) ----
  // Roster = column A of the "Technician & Asset Information" sheet ONLY (names).
  // NEVER store any other column of that sheet (it holds credentials/PII).
  await c`
    CREATE TABLE IF NOT EXISTS tech_roster (
      name TEXT PRIMARY KEY,
      sort_order INT NOT NULL DEFAULT 0,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`
    CREATE TABLE IF NOT EXISTS compliments (
      id BIGSERIAL PRIMARY KEY,
      technician TEXT NOT NULL,
      body TEXT NOT NULL,
      from_name TEXT NOT NULL,
      customer_name TEXT,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS compliments_created_idx ON compliments (created_at DESC)`;

  // ---- Referral awards (rev 41) ----
  // Source of truth is the weekly PAYROLL Google Sheet, not Pocomos: a referral
  // is an OTHER PAY row of exactly $50 whose NOTES cell holds the referred
  // customer's name. One row per (technician, customer) — the payroll sheet
  // repeats a referral across consecutive weeks, so the unique key dedupes it.
  await c`
    CREATE TABLE IF NOT EXISTS referral_awards (
      technician TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      week_ending DATE NOT NULL,
      payroll_name TEXT,
      source_file_id TEXT,
      source_file_title TEXT,
      source TEXT NOT NULL DEFAULT 'payroll',
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (technician, customer_name)
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS referral_awards_week_idx ON referral_awards (week_ending DESC)`;

  // Per-customer-per-year COMPLETED mosquito-family service counts (Event Spray
  // excluded — it's a separate contract, never on the mosquito service-history
  // table). Feeds the ops-canonical return-rate metric (§5.8): a "real year-Y
  // customer" / a "return" = received >= 1 completed mosquito service that year,
  // EXCEPT a late one-off (only spray after LATE_SEASON_CUTOFF, Aug 15). The
  // first/last service-date columns carry the earliest/last completed mosquito
  // spray per year so the late-one-off carve-out is computable. Filled by the
  // resumable scrape job (lib/service/serviceCounts.ts).
  await c`
    CREATE TABLE IF NOT EXISTS mosquito_service_counts (
      pocomos_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      service_count INTEGER NOT NULL,
      first_service_date DATE,
      last_service_date DATE,
      PRIMARY KEY (pocomos_id, year)
    )
  `;
  // Added 2026-07-13 (per-spray dates for the late-one-off return-rate carve-out).
  // Cover environments where the table predates these columns.
  await c`ALTER TABLE mosquito_service_counts ADD COLUMN IF NOT EXISTS first_service_date DATE`;
  await c`ALTER TABLE mosquito_service_counts ADD COLUMN IF NOT EXISTS last_service_date DATE`;
  // Added 2026-07-16 (rev 18): where a year's counts came from.
  //   'scrape'  = per-customer service-history scrape (the in-progress CY only)
  //   'export'  = an authoritative bulk export (2025 Pocomos completed-jobs,
  //               2024 RealGreen). Export rows are GROUND TRUTH and must never be
  //               pruned or overwritten by the nightly scrape — see
  //               serviceCounts.ts (it now touches year=CY / source='scrape' only).
  await c`ALTER TABLE mosquito_service_counts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'scrape'`;

  // ---- /service/resprays cache (rev 21) ----
  // Every completed MOSQUITO job this year (Initial / Regular / Re-service),
  // parsed from the Pocomos completed-jobs report. Truncate-and-reload from one
  // form POST; the page computes attribution on read (cheap — ~5.4k rows).
  await c`
    CREATE TABLE IF NOT EXISTS respray_jobs (
      invoice_no TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT,
      technician TEXT,
      job_type TEXT NOT NULL,
      service_type TEXT,
      completed_date DATE NOT NULL,
      address TEXT
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS respray_jobs_customer_idx ON respray_jobs (customer_id, completed_date)`;
  await c`CREATE INDEX IF NOT EXISTS respray_jobs_tech_idx ON respray_jobs (technician)`;
  // Wellness campaign (2026-07-20): the report's Address column, kept so the
  // feeder can push a street address to PhoneBurner without extra scrapes.
  await c`ALTER TABLE respray_jobs ADD COLUMN IF NOT EXISTS address TEXT`;

  // ---- Wellness-call campaign (2026-07-20) ----
  // One wellness call per customer per season — the row IS the re-entry guard:
  // the webhook inserts it FIRST (before the PhoneBurner folder move), so a
  // failed move or a re-fired webhook can never re-queue the customer.
  // pocomos_id = the INTERNAL customer id (7-digit url_id — what getDataset()
  // keys on, and directly usable for the Pocomos note write).
  await c`
    CREATE TABLE IF NOT EXISTS wellness_calls (
      pocomos_id  TEXT NOT NULL,
      season      INTEGER NOT NULL,
      called_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      disposition TEXT,
      csr_name    TEXT,
      pb_contact_id TEXT,
      PRIMARY KEY (pocomos_id, season)
    )
  `;

  // ---- /tv/techs award history (rev 28) ----
  // Who won which award in which board week. Written when the board is computed;
  // read only to avoid handing a tech the same award two weeks running. Tiny
  // (≤6 rows/week) and purely cosmetic — losing it just relaxes the repeat rule.
  await c`
    CREATE TABLE IF NOT EXISTS tv_tech_awards (
      week_start DATE NOT NULL,
      award_id TEXT NOT NULL,
      technician TEXT NOT NULL,
      PRIMARY KEY (week_start, award_id)
    )
  `;

  // ---- /leads/followup cache (rev 20) ----
  // Open THIS-YEAR leads + their follow-up task state. Filled by the nightly
  // cron (/api/cron/leads-followup) or "Refresh now"; the page only ever reads.
  // Truncate-and-reload, same pattern as mosquito_service_status.
  await c`
    CREATE TABLE IF NOT EXISTS leads_followup (
      lead_id TEXT PRIMARY KEY,
      name TEXT,
      created_date DATE,
      salesperson TEXT,
      marketing_type TEXT,
      phone TEXT,
      email TEXT,
      bucket TEXT NOT NULL,
      touches INTEGER NOT NULL DEFAULT 0,
      last_touch_at TIMESTAMPTZ,
      task_due_at TIMESTAMPTZ,
      days_overdue INTEGER,
      task_status TEXT,
      task_description TEXT,
      open_task_count INTEGER NOT NULL DEFAULT 0,
      archived_task_count INTEGER NOT NULL DEFAULT 0,
      pb_calls INTEGER NOT NULL DEFAULT 0,
      pb_last_call_at TIMESTAMPTZ
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS leads_followup_bucket_idx ON leads_followup (bucket)`;
  // Lead Notes signal (rev 25) — for the never-reached / loop-not-closed split.
  await c`ALTER TABLE leads_followup ADD COLUMN IF NOT EXISTS notes_count INTEGER NOT NULL DEFAULT 0`;
  await c`ALTER TABLE leads_followup ADD COLUMN IF NOT EXISTS last_note_at DATE`;
  // Closed-out bucket (rev 26) — completed-task date + Not-Interested reason.
  await c`ALTER TABLE leads_followup ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await c`ALTER TABLE leads_followup ADD COLUMN IF NOT EXISTS not_interested_reason TEXT`;

  // ---- Bulk ground-truth exports (rev 18) ----
  // Raw-ish landing tables for the two authoritative job exports. Kept beyond the
  // return-rate rebuild because they carry marketing-source fields we want for
  // later source analysis. Reloadable: each loader truncates its own table.
  await c`
    CREATE TABLE IF NOT EXISTS completed_jobs_2025 (
      invoice_no TEXT,
      short_id TEXT NOT NULL,
      customer_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      zip TEXT,
      job_type TEXT,
      lot_size TEXT,
      service_type TEXT,
      service_frequency TEXT,
      agreement TEXT,
      technician TEXT,
      completed_date DATE,
      branch TEXT
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS completed_jobs_2025_short_id_idx ON completed_jobs_2025 (short_id)`;
  await c`
    CREATE TABLE IF NOT EXISTS realgreen_jobs_2024 (
      short_id TEXT NOT NULL,
      customer_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      zip TEXT,
      done_date DATE,
      program_or_service_code TEXT,
      service_code TEXT,
      program_type TEXT,
      source_code TEXT,
      source_description TEXT,
      route_code TEXT,
      program_route_code TEXT,
      since_date DATE,
      customer_last_service_date DATE,
      discount_code TEXT,
      billing_type_description TEXT
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS realgreen_jobs_2024_short_id_idx ON realgreen_jobs_2024 (short_id)`;
  // ---- Pre-2024 RealGreen history (rev 33) ----
  // 2021-2023, loaded to give the return rate a 5-pair TREND instead of 2 points.
  // A single year-keyed table, unlike the year-suffixed 2024/2025 landing tables:
  // these three arrive together, are never curated individually, and are read
  // only in aggregate. `realgreen_jobs_2024` is deliberately NOT folded in here —
  // it feeds the /sales anomalies card, whose worklist must stay scoped to the
  // years ops actually reconciles (see lib/sales-anomalies.ts).
  await c`
    CREATE TABLE IF NOT EXISTS realgreen_jobs_history (
      year INT NOT NULL,
      short_id TEXT NOT NULL,
      customer_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      zip TEXT,
      done_date DATE,
      program_or_service_code TEXT,
      source_code TEXT,
      source_description TEXT,
      route_code TEXT,
      since_date DATE,
      billing_type_description TEXT
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS realgreen_jobs_history_year_idx ON realgreen_jobs_history (year, short_id)`;
  // Frozen return-rate pairs for COMPLETED, fully-export-backed season pairs that
  // predate Pocomos (21→22, 22→23, 23→24). Computed once at load time in
  // RealGreen SHORT-ID space — deliberately NOT through customer_id_map, which
  // only resolves customers who still exist in Pocomos and would therefore drop
  // exactly the churned customers a return-rate DENOMINATOR is made of. Frozen
  // because these seasons can never change again; keeps the history off the
  // /sales read path entirely.
  await c`
    CREATE TABLE IF NOT EXISTS return_rate_history (
      from_year INT PRIMARY KEY,
      to_year INT NOT NULL,
      real_from INT NOT NULL,
      returned INT NOT NULL,
      rate NUMERIC(5,2) NOT NULL,
      late_signups_from INT NOT NULL DEFAULT 0,
      built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // short_id (the 6-digit customer number used by BOTH exports) → pocomos web id
  // (the 7-digit id everything else in this app keys on). Pocomos exposes NO
  // short id on any API/bulk surface, so this map is built by matching contact
  // details — see lib/service/idMap.ts.
  await c`
    CREATE TABLE IF NOT EXISTS customer_id_map (
      short_id TEXT PRIMARY KEY,
      pocomos_id TEXT NOT NULL,
      match_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      matched_on TEXT,
      built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await c`CREATE INDEX IF NOT EXISTS customer_id_map_pocomos_idx ON customer_id_map (pocomos_id)`;
  // Coverage tracker: which cohort members have been scraped, and whether the
  // rendered service-history table was actually their mosquito contract
  // (table_ok=false = add-on customer whose default table isn't mosquito → we
  // never switch contracts, so their counts are unknown). Row-exists = scraped.
  await c`
    CREATE TABLE IF NOT EXISTS mosquito_service_scrape (
      pocomos_id TEXT PRIMARY KEY,
      table_ok BOOLEAN NOT NULL,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

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
  // Replay/duplicate gate (2026-07-21): the webhook hard-skips a note write
  // when a row with the same PB call_id already wrote one. Expression index
  // keeps that check cheap as the log grows.
  await c`CREATE INDEX IF NOT EXISTS webhook_log_call_id_idx ON webhook_log ((raw_payload->>'call_id'))`;

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
