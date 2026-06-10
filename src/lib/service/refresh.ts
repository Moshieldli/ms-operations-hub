/**
 * Scrape job + DB layer for the mosquito overdue-spray report.
 *
 * READ-ONLY against Pocomos: GETs /customer/{id}/service-history for each
 * eligible customer, parses the rendered table, and NEVER switches/POSTs. If a
 * customer's rendered contract isn't mosquito (their selected contract is
 * something else), they are recorded as 'needs_check' instead of being mutated.
 *
 * Performance: the page does NOT scrape on load — it reads the
 * `mosquito_service_status` table. This job (run by cron and the "Refresh now"
 * button) fills that table. It is budget-capped and resumable: customers are
 * processed oldest-checked-first (never-checked first), so repeated runs cover
 * the whole eligible set without blowing the Vercel function budget. Concurrency
 * is held low (5, the Pocomos cap) with a gentle per-request jitter.
 */
import { initSchema, sql, getSyncState, setSyncState } from "@/lib/db";
import { getDataset, fetchPooled } from "@/lib/pocomos";
import { getSessionedHtml } from "@/lib/pocomos/webSession";
import { parseServiceHistory, looksLikeLoginPage } from "./serviceHistory";
import {
  selectEligible,
  computeMosquitoStatus,
  renderedTableIsMosquito,
  type EligibleCustomer,
} from "./mosquito";

const RUN_META_KEY = "mosquito_service_refresh";
const SCRAPE_CONCURRENCY = 5; // Pocomos hard cap
const PER_REQUEST_PAUSE_MS = 200; // gentle on the web UI

export interface RefreshMeta {
  startedAt: string;
  finishedAt: string;
  eligible: number;
  scraped: number;
  overdue: number;
  current: number;
  needsCheck: number;
  failed: number;
  reachedEndOfQueue: boolean;
  durationMs: number;
}

export interface RefreshOptions {
  /** Stop scraping once this many ms have elapsed (incl. dataset build). */
  budgetMs?: number;
  /** Cap on customers scraped this invocation. */
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

/**
 * Order the eligible set so the freshest run covers the staleest customers
 * first: never-checked customers (not in the table) lead, then by oldest
 * `last_checked_at`. Also drops rows for customers no longer eligible.
 */
async function orderByStaleness(
  eligible: EligibleCustomer[]
): Promise<EligibleCustomer[]> {
  const rows = (await sql`
    SELECT pocomos_id, last_checked_at FROM mosquito_service_status
  `) as Array<{ pocomos_id: string; last_checked_at: string }>;
  const checkedAt = new Map(rows.map((r) => [r.pocomos_id, Date.parse(r.last_checked_at)]));

  // Prune customers that fell out of eligibility (cancelled, etc.).
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const stale = rows.filter((r) => !eligibleIds.has(r.pocomos_id)).map((r) => r.pocomos_id);
  if (stale.length) {
    await sql`DELETE FROM mosquito_service_status WHERE pocomos_id = ANY(${stale})`;
  }

  return [...eligible].sort((a, b) => {
    const ta = checkedAt.has(a.id) ? (checkedAt.get(a.id) as number) : -1;
    const tb = checkedAt.has(b.id) ? (checkedAt.get(b.id) as number) : -1;
    return ta - tb; // never-checked (-1) first, then oldest-checked
  });
}

/**
 * Scrape eligible customers and upsert their mosquito status. Budget-capped and
 * resumable; safe to call repeatedly.
 */
export async function refreshMosquitoStatus(
  options: RefreshOptions = {}
): Promise<RefreshMeta> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const budgetMs = options.budgetMs ?? 250_000;
  const maxCustomers = options.maxCustomers ?? 5000;
  await initSchema();

  const ds = await getDataset({ force: options.forceDataset ?? false });
  const eligibleAll = selectEligible(ds.customers);
  const ordered = await orderByStaleness(eligibleAll);
  const work = ordered.slice(0, maxCustomers);

  let scraped = 0;
  let overdue = 0;
  let current = 0;
  let needsCheck = 0;
  let failed = 0;
  let budgetHit = false;

  const fetchOne = async (e: EligibleCustomer): Promise<void> => {
    // Out of time: no-op (counts as success so it isn't a "failure"). The
    // customer keeps its old/absent last_checked_at and leads the next run.
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

    const st = computeMosquitoStatus(parsed.rows);
    if (st.status === "overdue") overdue++;
    else current++;
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

  const result = await fetchPooled(work, fetchOne, {
    concurrency: SCRAPE_CONCURRENCY,
  });
  failed = result.failures.length;

  const meta: RefreshMeta = {
    startedAt,
    finishedAt: new Date().toISOString(),
    eligible: eligibleAll.length,
    scraped,
    overdue,
    current,
    needsCheck,
    failed,
    // We covered the whole queue if we didn't trim for the cap and didn't bail on budget.
    reachedEndOfQueue: !budgetHit && work.length === ordered.length,
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
