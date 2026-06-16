import { initSchema, sql } from "@/lib/db";
import { postSessioned } from "@/lib/pocomos/webSession";

/**
 * Leads RAW close-rate report, sourced from the Pocomos /leads/data web
 * back-door (legacy DataTables 1.9 body — same session mechanism as
 * leadSync.ts) but WITHOUT the `statuses[]=Lead` filter, so every status is
 * returned.
 *
 * Metric (v1 — raw only):
 *   Raw close rate = (leads created in the period whose status is now
 *   "Customer") ÷ (all leads created in the period, any status) × 100.
 *   Period is bounded by `date_added`.
 *
 * NOTE (verified 2026-06-16): this office's /leads/data does NOT surface
 * "Customer"-status rows (only Lead / Not Interested / Monitor) — converted
 * leads leave the leads module (likely the `mstli.apiuser` saved-view scoping).
 * The conversion logic below keys on status === "Customer" exactly as specified,
 * so it lights up the moment those rows appear; until then `totalConversions`
 * reads 0 and the UI shows a banner. `statusBreakdown` is returned so callers
 * can detect this.
 */

const POCOMOS_COLUMNS = [
  "name_with_company",
  "address",
  "phone",
  "map_code",
  "status",
  "date_added",
  "salesperson",
  "note",
  "function",
] as const;
const PAGE_SIZE = 200;

// Salespeople that are NOT real CSRs — their leads are bucketed "Unattributed"
// rather than distorting a rep's denominator. Blank salesperson is also
// unattributed. Extend this set as more system/non-CSR names surface.
const NON_CSR = new Set(["api user", "apiuser", "pronexis", "system", "admin"]);

export interface RepRow {
  salesperson: string;
  leads: number;
  conversions: number;
  closeRate: number; // percent
}

export interface LeadsCloseRateReport {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  totalLeads: number;
  totalConversions: number;
  closeRate: number; // percent
  attributedLeads: number;
  unattributedLeads: number;
  unattributedConversions: number;
  reps: RepRow[];
  /** Telemetry: count per raw status value in the period. */
  statusBreakdown: Record<string, number>;
  /** True when no "Customer"-status rows were present (conversion source gap). */
  conversionSourceMissing: boolean;
  computedAt: string;
}

interface LeadsDataResponse {
  aaData?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
}

async function fetchLeadsPage(start: number): Promise<Array<Record<string, unknown>>> {
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(POCOMOS_COLUMNS.length));
  body.set("sColumns", ",".repeat(POCOMOS_COLUMNS.length - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  for (let i = 0; i < POCOMOS_COLUMNS.length; i++) {
    body.set(`mDataProp_${i}`, POCOMOS_COLUMNS[i]);
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, i === POCOMOS_COLUMNS.length - 1 ? "false" : "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortCol_0", String(POCOMOS_COLUMNS.indexOf("date_added")));
  body.set("sSortDir_0", "desc");
  body.set("iSortingCols", "1");
  // DELIBERATELY no `statuses[]=Lead` — we want every status (incl. Customer).
  body.set("salesperson", "");
  const resp = await postSessioned<LeadsDataResponse>("/leads/data", body, {
    referer: "/leads/",
  });
  return resp.aaData ?? resp.data ?? [];
}

/** Pull every lead row (all statuses). READ-ONLY. */
export async function fetchAllLeads(): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  for (let start = 0; start < 60_000; start += PAGE_SIZE) {
    const rows = await fetchLeadsPage(start);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

function datePart(raw: unknown): string {
  return String(raw ?? "").slice(0, 10);
}

function isConverted(row: Record<string, unknown>): boolean {
  return String(row.status ?? "").trim().toLowerCase() === "customer";
}

/**
 * FUTURE HOOK — "real lead" filter for the denominator. v1 counts ALL leads in
 * the period (raw close rate). A later "real close rate" will exclude
 * never-reached + wrong-company leads here, e.g.:
 *   const r = String(row.reason_name ?? "").toLowerCase();
 *   if (r === "can't reach" || r === "competitor") return false;
 * Do NOT enable yet — keep v1 raw. Returning true keeps every lead in scope.
 */
function isRealLead(row: Record<string, unknown>): boolean {
  void row; // referenced so the hook param stays documented (no-op in v1)
  return true;
}

function repKey(row: Record<string, unknown>): string | null {
  const sp = String(row.salesperson ?? "").trim();
  if (!sp) return null; // blank → unattributed
  if (NON_CSR.has(sp.toLowerCase())) return null; // system/non-CSR → unattributed
  return sp;
}

export function computeReport(
  rows: Array<Record<string, unknown>>,
  periodStart: string,
  periodEnd: string
): LeadsCloseRateReport {
  const inPeriod = rows.filter((r) => {
    const d = datePart(r.date_added);
    return d >= periodStart && d <= periodEnd && isRealLead(r);
  });

  const statusBreakdown: Record<string, number> = {};
  let totalLeads = 0;
  let totalConversions = 0;
  let attributedLeads = 0;
  let unattributedLeads = 0;
  let unattributedConversions = 0;
  const repMap = new Map<string, { leads: number; conversions: number }>();

  for (const r of inPeriod) {
    const status = String(r.status ?? "(none)");
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

    totalLeads++;
    const conv = isConverted(r);
    if (conv) totalConversions++;

    const key = repKey(r);
    if (key == null) {
      unattributedLeads++;
      if (conv) unattributedConversions++;
    } else {
      attributedLeads++;
      const cur = repMap.get(key) || { leads: 0, conversions: 0 };
      cur.leads++;
      if (conv) cur.conversions++;
      repMap.set(key, cur);
    }
  }

  const reps: RepRow[] = [...repMap.entries()]
    .map(([salesperson, v]) => ({
      salesperson,
      leads: v.leads,
      conversions: v.conversions,
      closeRate: v.leads ? (v.conversions / v.leads) * 100 : 0,
    }))
    .sort((a, b) => b.leads - a.leads || a.salesperson.localeCompare(b.salesperson));

  return {
    periodStart,
    periodEnd,
    totalLeads,
    totalConversions,
    closeRate: totalLeads ? (totalConversions / totalLeads) * 100 : 0,
    attributedLeads,
    unattributedLeads,
    unattributedConversions,
    reps,
    statusBreakdown,
    conversionSourceMissing: totalConversions === 0,
    computedAt: new Date().toISOString(),
  };
}

/** Default period: Jan 1 of the current year → today (local). */
export function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { start: `${y}-01-01`, end: `${y}-${m}-${d}` };
}

export async function computeCloseRate(
  periodStart: string,
  periodEnd: string
): Promise<LeadsCloseRateReport> {
  const rows = await fetchAllLeads();
  return computeReport(rows, periodStart, periodEnd);
}

export async function getCachedReport(): Promise<LeadsCloseRateReport | null> {
  await initSchema();
  const rows = (await sql`SELECT report FROM leads_close_rate WHERE id = 1`) as Array<{
    report: LeadsCloseRateReport;
  }>;
  return rows.length ? rows[0].report : null;
}

/** Recompute the default-period report and cache it (singleton row). */
export async function refreshCloseRate(): Promise<LeadsCloseRateReport> {
  await initSchema();
  const { start, end } = defaultPeriod();
  const report = await computeCloseRate(start, end);
  await sql`
    INSERT INTO leads_close_rate (id, period_start, period_end, report, computed_at)
    VALUES (1, ${start}, ${end}, ${JSON.stringify(report)}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      report = EXCLUDED.report,
      computed_at = NOW()
  `;
  return report;
}
