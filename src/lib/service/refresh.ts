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
import { fetchOpenBalances } from "./openBalance";
import {
  selectEligible,
  computeMosquitoStatus,
  statusFromLastServiceDate,
  preServiceBucket,
  renderedTableIsMosquito,
  parseDbDate,
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
  /** Eligible customers with an open balance > 0 (spray intentionally paused). */
  pausedBalance: number;
  /** Eligible customers excluded as brand-new signups (< grace days). */
  excludedNew: number;
  /** Subset of overdue with no service date at all (pinned "no spray yet"). */
  noServiceYet: number;
  failed: number;
  /** Customers found in the unpaid-invoices report (telemetry). */
  balanceCustomers: number;
  /** Sum of all open balances across eligible customers (telemetry). */
  openBalanceTotal: number;
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

/** Local-midnight Date → "YYYY-MM-DD". */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  signUpDate: string | null;
  openBalance: number;
  /** Next scheduled service (any type) from /customers/data col 9, ISO or null. */
  nextServiceDate: string | null;
  /** Weekly-cadence marker for the display-only "Weekly" pill. */
  isWeekly: boolean;
}

/** Single-row upsert (used by the scrape path). */
async function upsert(row: UpsertRow): Promise<void> {
  await sql`
    INSERT INTO mosquito_service_status (
      pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
      last_regular_spray, days_since, status, reason, sign_up_date, open_balance,
      next_service_date, is_weekly, last_checked_at
    ) VALUES (
      ${row.id}, ${row.fullName}, ${row.mosquitoContractType}, ${row.selectedContractLabel},
      ${row.lastRegularSpray}, ${row.daysSince}, ${row.status}, ${row.reason},
      ${row.signUpDate}, ${row.openBalance}, ${row.nextServiceDate}, ${row.isWeekly}, NOW()
    )
    ON CONFLICT (pocomos_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      mosquito_contract_type = EXCLUDED.mosquito_contract_type,
      selected_contract_label = EXCLUDED.selected_contract_label,
      last_regular_spray = EXCLUDED.last_regular_spray,
      days_since = EXCLUDED.days_since,
      status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      sign_up_date = EXCLUDED.sign_up_date,
      open_balance = EXCLUDED.open_balance,
      next_service_date = EXCLUDED.next_service_date,
      is_weekly = EXCLUDED.is_weekly,
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
    const signUps = chunk.map((r) => r.signUpDate);
    const balances = chunk.map((r) => r.openBalance);
    const nexts = chunk.map((r) => r.nextServiceDate);
    const weeklies = chunk.map((r) => r.isWeekly);
    await sql`
      INSERT INTO mosquito_service_status (
        pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
        last_regular_spray, days_since, status, reason, sign_up_date, open_balance,
        next_service_date, is_weekly, last_checked_at
      )
      SELECT pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
             last_regular_spray, days_since, status, reason, sign_up_date, open_balance,
             next_service_date, is_weekly, NOW()
      FROM UNNEST(
        ${ids}::text[], ${names}::text[], ${types}::text[], ${labels}::text[],
        ${sprays}::date[], ${days}::int[], ${statuses}::text[], ${reasons}::text[],
        ${signUps}::date[], ${balances}::numeric[], ${nexts}::date[], ${weeklies}::boolean[]
      ) AS t(pocomos_id, full_name, mosquito_contract_type, selected_contract_label,
             last_regular_spray, days_since, status, reason, sign_up_date, open_balance,
             next_service_date, is_weekly)
      ON CONFLICT (pocomos_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        mosquito_contract_type = EXCLUDED.mosquito_contract_type,
        selected_contract_label = EXCLUDED.selected_contract_label,
        last_regular_spray = EXCLUDED.last_regular_spray,
        days_since = EXCLUDED.days_since,
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        sign_up_date = EXCLUDED.sign_up_date,
        open_balance = EXCLUDED.open_balance,
        next_service_date = EXCLUDED.next_service_date,
        is_weekly = EXCLUDED.is_weekly,
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
  let pausedBalance = 0;
  let excludedNew = 0;
  let failed = 0;

  // ---- Bulk sources (both cheap, READ-ONLY): "Last Service" + sign-up date
  //      from /customers/data, and open balances from the Unpaid Invoices
  //      report. ----
  const bulk = await fetchAllCustomersLastService();
  const balances = await fetchOpenBalances(now);

  // Sign-up now comes from the ELIGIBLE mosquito contract's top-level
  // `date_start` (carried on EligibleCustomer.signUpDate) — the active contract
  // that passed eligibility — NOT grid col 7 (the customer's stale ORIGINAL
  // signup) and NEVER date_end (stale on auto-renew contracts). This is what
  // Pocomos's Edit screen shows as "Date Signed Up".
  const balanceFor = (id: string): number => balances.byId.get(id)?.balance ?? 0;
  /** Next scheduled service (any type) from /customers/data col 9, ISO or null. */
  const nextServiceFor = (id: string): string | null => {
    const d = bulk.byId.get(id)?.nextService ?? null;
    return d ? toIso(d) : null;
  };

  // ---- BULK phase: everything resolvable without a scrape. That's
  //      mosquito-only customers (their "Last Service" IS their mosquito date)
  //      PLUS any eligible customer the precedence rules settle up front
  //      (open balance > 0 → paused; brand-new signup → excluded), regardless
  //      of add-on status. Add-on customers caught by precedence never need a
  //      scrape. ----
  const bulkRows: UpsertRow[] = [];
  const toScrape: EligibleCustomer[] = [];

  for (const e of eligible) {
    const signUpDate = e.signUpDate; // active mosquito contract's date_start (ISO)
    const signUp = parseDbDate(signUpDate); // for the new-signup grace check
    const openBalance = balanceFor(e.id);
    const nextServiceDate = nextServiceFor(e.id);
    const pre = preServiceBucket(openBalance, signUp, now);

    if (pre) {
      if (pre.status === "paused_balance") pausedBalance++;
      else excludedNew++;
      bulkRows.push({
        id: e.id,
        fullName: e.fullName,
        mosquitoContractType: e.mosquitoContractType,
        selectedContractLabel: null,
        lastRegularSpray: pre.lastRegularSpray,
        daysSince: pre.daysSince,
        status: pre.status,
        reason: pre.reason,
        signUpDate,
        openBalance,
        nextServiceDate,
        isWeekly: e.isWeekly,
      });
      continue;
    }

    if (e.hasAddOn) {
      // Needs the targeted service-history scrape to get a mosquito-specific date.
      toScrape.push(e);
      continue;
    }

    // Mosquito-only: bulk "Last Service" date is authoritative.
    const st = statusFromLastServiceDate(bulk.byId.get(e.id)?.lastService ?? null, now);
    if (st.status === "overdue") {
      overdue++;
      if (st.daysSince == null) noServiceYet++;
    } else {
      current++;
    }
    bulkRows.push({
      id: e.id,
      fullName: e.fullName,
      mosquitoContractType: e.mosquitoContractType,
      selectedContractLabel: null,
      lastRegularSpray: st.lastRegularSpray,
      daysSince: st.daysSince,
      status: st.status,
      reason: st.reason,
      signUpDate,
      openBalance,
      nextServiceDate,
      isWeekly: e.isWeekly,
    });
  }
  await bulkUpsert(bulkRows);

  // ---- SCRAPE phase: add-on customers with no balance / not brand-new,
  //      targeted per-page (READ-ONLY GET). ----
  const work = toScrape.slice(0, maxCustomers);
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
    const signUpDate = e.signUpDate; // active mosquito contract's date_start (ISO)
    const nextServiceDate = nextServiceFor(e.id);

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
        signUpDate,
        openBalance: 0,
        nextServiceDate,
        isWeekly: e.isWeekly,
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
      signUpDate,
      openBalance: 0,
      nextServiceDate,
      isWeekly: e.isWeekly,
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
    pausedBalance,
    excludedNew,
    noServiceYet,
    failed,
    balanceCustomers: balances.byId.size,
    openBalanceTotal: balances.totalBalance,
    reachedEndOfQueue: !budgetHit && work.length === toScrape.length,
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
  sign_up_date: string | null;
  open_balance: number;
  next_service_date: string | null;
  is_weekly: boolean;
  last_checked_at: string;
}

export interface OverdueReport {
  overdue: MosquitoStatusRow[];
  /** Eligible customers with an open balance > 0 (spray paused), balance DESC. */
  pausedBalance: MosquitoStatusRow[];
  needsCheck: MosquitoStatusRow[];
  counts: {
    overdue: number;
    current: number;
    needsCheck: number;
    pausedBalance: number;
    excludedNew: number;
    total: number;
  };
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
    sign_up_date: toDateStr(r.sign_up_date),
    open_balance: r.open_balance == null ? 0 : Number(r.open_balance),
    next_service_date: toDateStr(r.next_service_date),
    is_weekly: r.is_weekly === true,
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
  const pausedBalance = all
    .filter((r) => r.status === "paused_balance")
    .sort((a, b) => b.open_balance - a.open_balance);
  const currentCount = all.filter((r) => r.status === "current").length;
  const excludedNewCount = all.filter((r) => r.status === "excluded_new").length;

  let lastRefreshedAt: string | null = null;
  for (const r of all) {
    if (!lastRefreshedAt || r.last_checked_at > lastRefreshedAt) {
      lastRefreshedAt = r.last_checked_at;
    }
  }

  const meta = await getSyncState<RefreshMeta>(RUN_META_KEY);

  return {
    overdue,
    pausedBalance,
    needsCheck,
    counts: {
      overdue: overdue.length,
      current: currentCount,
      needsCheck: needsCheck.length,
      pausedBalance: pausedBalance.length,
      excludedNew: excludedNewCount,
      total: all.length,
    },
    meta,
    lastRefreshedAt,
  };
}

export async function getRefreshMeta(): Promise<RefreshMeta | null> {
  return getSyncState<RefreshMeta>(RUN_META_KEY);
}
