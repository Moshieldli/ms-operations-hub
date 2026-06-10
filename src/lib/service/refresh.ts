/**
 * Refresh job + DB layer for the mosquito overdue-spray report.
 *
 * HYBRID source (rebuilt 2026-06-10 — was: scrape all ~1,100 service-history
 * pages, ~30 min). The JWT contract object has NO usable last-service date
 * (confirmed by probe), so:
 *
 *   1. BULK — POST /customers/data (web back-door, ~6 pages) gives every
 *      customer's "Last Service" date (column 8, any service type). For
 *      mosquito-ONLY eligible customers (no active non-mosquito contract, ~79%)
 *      that date IS their mosquito service date → no scrape.
 *   2. SCRAPE — add-on eligible customers (~21%, also hold an active
 *      non-mosquito contract) get the existing per-page service-history scrape
 *      so the date is mosquito-contract-specific, not the add-on's.
 *
 * A full refresh now finishes in ~1 min instead of ~30.
 *
 * READ-ONLY against Pocomos: GET service-history pages, POST only the
 * DataTables read endpoint. NEVER switches the selected contract / mutates a
 * record. If a scraped customer's rendered contract isn't mosquito, they are
 * recorded as 'needs_check' instead of being mutated.
 *
 * The page never scrapes on load — it reads `mosquito_service_status`, which
 * this job (cron + "Refresh now") fills. Eligibility is tightened in
 * mosquito.ts: active customer + active mosquito contract carrying a
 * current-year tag (drops zombie "active-in-name-only" accounts).
 */
import { initSchema, sql, getSyncState, setSyncState } from "@/lib/db";
import { getDataset, fetchPooled } from "@/lib/pocomos";
import { getSessionedHtml } from "@/lib/pocomos/webSession";
import { parseServiceHistory, looksLikeLoginPage } from "./serviceHistory";
import { fetchAllCustomersLastService } from "./customersData";
import {
  selectEligible,
  computeMosquitoStatus,
  statusFromLastServiceDate,
  renderedTableIsMosquito,
  type EligibleCustomer,
} from "./mosquito";

const RUN_META_KEY = "mosquito_service_refresh";
const SCRAPE_CONCURRENCY = 5; // Pocomos hard cap
const PER_REQUEST_PAUSE_MS = 150; // gentle on the web UI
const BULK_UPSERT_CHUNK = 500;

export interface RefreshMeta {
  startedAt: string;
  finishedAt: string;
  /** Total eligible (active customer + active mosquito contract + current-year tag). */
  eligible: number;
  /** Mosquito-only eligible, resolved from the bulk /customers/data date. */
  mosquitoOnly: number;
  /** Add-on eligible (need a targeted scrape). */
  addOn: number;
  /** Pages pulled from /customers/data. */
  bulkPages: number;
  /** Add-on customers actually scraped this run. */
  scraped: number;
  overdue: number;
  current: number;
  needsCheck: number;
  /** Subset of overdue with no service date at all (pinned "no spray yet"). */
  noServiceYet: number;
  failed: number;
  reachedEndOfQueue: boolean;
  durationMs: number;
}

export interface RefreshOptions {
  /** Stop scraping once this many ms have elapsed (incl. dataset build). */
  budgetMs?: number;
  /** Cap on add-on customers scraped this invocation. */
  maxCustomers?: number;
  /** Force a fresh Pocomos dataset build rather than the 10-min cache. */
  forceDataset?: boolean;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

interface UpsertRow {
  id: string;
  fullName: string;
  mosquitoContractType: string;
  selectedContractLabel: string | null;
  lastRegularSpray: string | null;
  daysSince: number | null;
  status: string;
  reason: string;
}

/** Single-row upsert (used by the scrape path). */
async function upsert(row: UpsertRow): Promise<void> {
  await sql`
    INSERT INTO mosquito_service_status (
      pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
      last_regular_spray, days_since, status, reason, last_checked_at
    ) VALUES (
      ${row.id}, ${row.fullName}, ${row.mosquitoContractType}, ${row.selectedContractLabel},
      ${row.lastRegularSpray}, ${row.daysSince}, ${row.status}, ${row.reason}, NOW()
    )
    ON CONFLICT (pocomos_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      mosquito_contract_type = EXCLUDED.mosquito_contract_type,
      selected_contract_label = EXCLUDED.selected_contract_label,
      last_regular_spray = EXCLUDED.last_regular_spray,
      days_since = EXCLUDED.days_since,
      status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      last_checked_at = NOW()
  `;
}

/** Multi-row upsert via UNNEST (used by the bulk path) — one statement per chunk. */
async function bulkUpsert(rows: UpsertRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BULK_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + BULK_UPSERT_CHUNK);
    const ids = chunk.map((r) => r.id);
    const names = chunk.map((r) => r.fullName);
    const types = chunk.map((r) => r.mosquitoContractType);
    const labels = chunk.map((r) => r.selectedContractLabel);
    const sprays = chunk.map((r) => r.lastRegularSpray);
    const days = chunk.map((r) => r.daysSince);
    const statuses = chunk.map((r) => r.status);
    const reasons = chunk.map((r) => r.reason);
    await sql`
      INSERT INTO mosquito_service_status (
        pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
        last_regular_spray, days_since, status, reason, last_checked_at
      )
      SELECT pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
             last_regular_spray, days_since, status, reason, NOW()
      FROM UNNEST(
        ${ids}::text[], ${names}::text[], ${types}::text[], ${labels}::text[],
        ${sprays}::date[], ${days}::int[], ${statuses}::text[], ${reasons}::text[]
      ) AS t(pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
             last_regular_spray, days_since, status, reason)
      ON CONFLICT (pocomos_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        mosquito_contract_type = EXCLUDED.mosquito_contract_type,
        selected_contract_label = EXCLUDED.selected_contract_label,
        last_regular_spray = EXCLUDED.last_regular_spray,
        days_since = EXCLUDED.days_since,
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        last_checked_at = NOW()
    `;
  }
}

/** Drop rows for customers no longer eligible (cancelled, lost current-year tag, etc.). */
async function pruneStale(eligibleIds: Set<string>): Promise<number> {
  const rows = (await sql`
    SELECT pocomos_id FROM mosquito_service_status
  `) as Array<{ pocomos_id: string }>;
  const stale = rows
    .map((r) => String(r.pocomos_id))
    .filter((id) => !eligibleIds.has(id));
  if (stale.length) {
    await sql`DELETE FROM mosquito_service_status WHERE pocomos_id = ANY(${stale})`;
  }
  return stale.length;
}

/**
 * Refresh the whole eligible set: bulk for mosquito-only, targeted scrape for
 * add-on. Budget-capped on the scrape phase; the bulk phase is cheap (~6 POSTs).
 */
export async function refreshMosquitoStatus(
  options: RefreshOptions = {}
): Promise<RefreshMeta> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const budgetMs = options.budgetMs ?? 250_000;
  const maxCustomers = options.maxCustomers ?? 5000;
  const now = new Date();
  await initSchema();

  const ds = await getDataset({ force: options.forceDataset ?? false });
  const eligible = selectEligible(ds.customers);
  const eligibleIds = new Set(eligible.map((e) => e.id));
  await pruneStale(eligibleIds);

  const mosquitoOnly = eligible.filter((e) => !e.hasAddOn);
  const addOn = eligible.filter((e) => e.hasAddOn);

  let overdue = 0;
  let current = 0;
  let needsCheck = 0;
  let noServiceYet = 0;
  let failed = 0;

  // ---- BULK phase: mosquito-only via /customers/data "Last Service" ----
  const bulk = await fetchAllCustomersLastService();
  const bulkRows: UpsertRow[] = mosquitoOnly.map((e) => {
    const rec = bulk.byId.get(e.id);
    const st = statusFromLastServiceDate(rec?.lastService ?? null, now);
    if (st.status === "overdue") {
      overdue++;
      if (st.daysSince == null) noServiceYet++;
    } else {
      current++;
    }
    return {
      id: e.id,
      fullName: e.fullName,
      mosquitoContractType: e.mosquitoContractType,
      // Not a needs_check row; bulk path has no selected-contract label.
      selectedContractLabel: null,
      lastRegularSpray: st.lastRegularSpray,
      daysSince: st.daysSince,
      status: st.status,
      reason: st.reason,
    };
  });
  await bulkUpsert(bulkRows);

  // ---- SCRAPE phase: add-on customers, targeted per-page (READ-ONLY GET) ----
  const work = addOn.slice(0, maxCustomers);
  let scraped = 0;
  let budgetHit = false;

  const scrapeOne = async (e: EligibleCustomer): Promise<void> => {
    if (Date.now() - t0 > budgetMs) {
      budgetHit = true;
      return;
    }
    await sleep(PER_REQUEST_PAUSE_MS);
    const html = await getSessionedHtml(`/customer/${e.id}/service-history`);
    if (looksLikeLoginPage(html)) {
      throw new Error("login page returned (session)");
    }
    const parsed = parseServiceHistory(html);

    if (!renderedTableIsMosquito(parsed.tableContractLabel, parsed.selectedContractLabel)) {
      // Selected contract isn't mosquito — DO NOT switch. Flag for manual check.
      needsCheck++;
      await upsert({
        id: e.id,
        fullName: e.fullName,
        mosquitoContractType: e.mosquitoContractType,
        selectedContractLabel: parsed.tableContractLabel ?? parsed.selectedContractLabel,
        lastRegularSpray: null,
        daysSince: null,
        status: "needs_check",
        reason: "mosquito_not_selected",
      });
      scraped++;
      return;
    }

    const st = computeMosquitoStatus(parsed.rows, now);
    if (st.status === "overdue") {
      overdue++;
      if (st.daysSince == null) noServiceYet++;
    } else {
      current++;
    }
    await upsert({
      id: e.id,
      fullName: e.fullName,
      mosquitoContractType: e.mosquitoContractType,
      selectedContractLabel: parsed.tableContractLabel ?? parsed.selectedContractLabel,
      lastRegularSpray: st.lastRegularSpray,
      daysSince: st.daysSince,
      status: st.status,
      reason: st.reason,
    });
    scraped++;
  };

  const result = await fetchPooled(work, scrapeOne, {
    concurrency: SCRAPE_CONCURRENCY,
  });
  failed = result.failures.length;

  const meta: RefreshMeta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    eligible: eligible.length,
    mosquitoOnly: mosquitoOnly.length,
    addOn: addOn.length,
    bulkPages: bulk.pages,
    scraped,
    overdue,
    current,
    needsCheck,
    noServiceYet,
    failed,
    reachedEndOfQueue: !budgetHit && work.length === addOn.length,
    durationMs: Date.now() - t0,
  };
  await setSyncState(RUN_META_KEY, meta);
  return meta;
}

// -------------------------- read side (page data) --------------------------

export interface MosquitoStatusRow {
  pocomos_id: string;
  full_name: string | null;
  mosquito_contract_type: string | null;
  selected_contract_label: string | null;
  last_regular_spray: string | null;
  days_since: number | null;
  status: string;
  reason: string | null;
  last_checked_at: string;
}

export interface OverdueReport {
  overdue: MosquitoStatusRow[];
  needsCheck: MosquitoStatusRow[];
  counts: { overdue: number; current: number; needsCheck: number; total: number };
  meta: RefreshMeta | null;
  /** Most recent last_checked_at across all rows (ISO), or null if empty. */
  lastRefreshedAt: string | null;
}

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function normalizeRow(r: Record<string, unknown>): MosquitoStatusRow {
  return {
    pocomos_id: String(r.pocomos_id),
    full_name: (r.full_name as string) ?? null,
    mosquito_contract_type: (r.mosquito_contract_type as string) ?? null,
    selected_contract_label: (r.selected_contract_label as string) ?? null,
    last_regular_spray: toDateStr(r.last_regular_spray),
    days_since: r.days_since == null ? null : Number(r.days_since),
    status: String(r.status),
    reason: (r.reason as string) ?? null,
    last_checked_at:
      r.last_checked_at instanceof Date
        ? (r.last_checked_at as Date).toISOString()
        : String(r.last_checked_at),
  };
}

/**
 * Read the report straight from the table (no scraping). Overdue is sorted by
 * days_since DESC with "no spray yet" (null days_since) pinned to the top.
 */
export async function getOverdueReport(): Promise<OverdueReport> {
  await initSchema();
  const rows = (await sql`
    SELECT * FROM mosquito_service_status
  `) as Array<Record<string, unknown>>;
  const all = rows.map(normalizeRow);

  const overdue = all
    .filter((r) => r.status === "overdue")
    .sort((a, b) => {
      // null days_since (no spray yet) first, then largest days_since.
      if (a.days_since == null && b.days_since == null) return 0;
      if (a.days_since == null) return -1;
      if (b.days_since == null) return 1;
      return b.days_since - a.days_since;
    });
  const needsCheck = all
    .filter((r) => r.status === "needs_check")
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  const currentCount = all.filter((r) => r.status === "current").length;

  let lastRefreshedAt: string | null = null;
  for (const r of all) {
    if (!lastRefreshedAt || r.last_checked_at > lastRefreshedAt) {
      lastRefreshedAt = r.last_checked_at;
    }
  }

  const meta = await getSyncState<RefreshMeta>(RUN_META_KEY);

  return {
    overdue,
    needsCheck,
    counts: {
      overdue: overdue.length,
      current: currentCount,
      needsCheck: needsCheck.length,
      total: all.length,
    },
    meta,
    lastRefreshedAt,
  };
}

export async function getRefreshMeta(): Promise<RefreshMeta | null> {
  return getSyncState<RefreshMeta>(RUN_META_KEY);
}
