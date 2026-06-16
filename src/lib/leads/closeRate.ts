import { initSchema, sql } from "@/lib/db";
import {
  postSessioned,
  getSessionedHtml,
  getPocomosSession,
  pocomosWebBase,
  invalidateSession,
  looksLikeSessionExpired,
} from "@/lib/pocomos/webSession";

/**
 * Leads RAW close-rate report, sourced from the Pocomos **Lead Advanced Search**
 * feed (the only feed that returns converted/"Customer" leads).
 *
 * The plain `/leads/data` "View All" list is server-scoped to OPEN leads only
 * (Lead / Not Interested / Monitor) and can never return Customer rows — no
 * parameter changes that (confirmed by probes). Converted leads are NOT gone;
 * they're reachable through the Advanced Search two-step flow:
 *
 *   1. setAdvancedSearchCriteria() — scrape `search[_token]` from
 *      /leads/advanced-search/show, then POST /leads/lead-advanced-search with
 *      `search[leadStatus][]` for ALL FIVE statuses (Lead, Not Home, Not
 *      Interested, Customer, Monitor) + branch + token. This stores the criteria
 *      in the PHP session.
 *   2. fetchAllLeads() — POST /lead/lead-advanced-search/data (legacy DataTables
 *      1.9 body) which reads the session criteria and returns `aaData` keyed
 *      objects (id, status, date_added, salesperson, first_name, phone).
 *
 * Both halves of the metric come from THIS one feed (do NOT reuse the old
 * /leads/data denominator — it excludes the converted leads and would overstate
 * the rate).
 *
 * Metric (v1 — raw only):
 *   Raw close rate = (leads created in the period whose status is "Customer")
 *   ÷ (all leads created in the period, any status) × 100. Period bounded by
 *   `date_added` in code. READ-ONLY against Pocomos (GET + DataTables-read POST).
 */

const ADV_SHOW = "/leads/advanced-search/show";
const ADV_SUBMIT = "/leads/lead-advanced-search";
const ADV_FEED = "/lead/lead-advanced-search/data";
const LEAD_STATUSES = ["Lead", "Not Home", "Not Interested", "Customer", "Monitor"] as const;
const OFFICE = process.env.POCOMOS_OFFICE || "1512";

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
  computedAt: string;
}

interface LeadsDataResponse {
  aaData?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  type?: string;
  redirect?: string;
}

/**
 * Step 1 — register "all five lead statuses" as the Advanced Search criteria in
 * the session, so the feed (step 2) returns every status incl. Customer. POSTs
 * the Symfony search form (returns HTML, not JSON) using the raw session cookie.
 * Re-logs once on session expiry.
 */
async function setAdvancedSearchCriteria(): Promise<void> {
  const html = await getSessionedHtml(ADV_SHOW);
  const token = (html.match(/name="search\[_token\]"[^>]*value="([^"]+)"/) || [])[1] || "";
  // Send every search[...] text input empty (Symfony form expectation), then
  // override the bits we actually filter on.
  const inputNames = new Set<string>();
  for (const m of html.matchAll(/<input\b[^>]*name="(search\[[^"]+\])"[^>]*>/gi)) {
    inputNames.add(m[1]);
  }
  const form = new URLSearchParams();
  for (const n of inputNames) if (!/_token/.test(n)) form.set(n, "");
  form.set("search[_token]", token);
  form.append("search[branches][]", OFFICE);
  form.set("search[allBranches]", "1");
  for (const s of LEAD_STATUSES) form.append("search[leadStatus][]", s);

  const submit = async (cookie: string) =>
    fetch(`${pocomosWebBase()}${ADV_SUBMIT}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: `${pocomosWebBase()}${ADV_SHOW}`,
        "User-Agent": "ms-operations-hub-sync/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      body: form.toString(),
      cache: "no-store",
    });

  let cookie = await getPocomosSession();
  let resp = await submit(cookie);
  let body = await resp.text();
  const expired =
    (resp.status >= 300 && resp.status < 400 && (resp.headers.get("location") || "").includes("/login")) ||
    looksLikeSessionExpired(body);
  if (expired) {
    await invalidateSession();
    cookie = await getPocomosSession();
    // re-scrape the token under the fresh session before resubmitting
    const fresh = await getSessionedHtml(ADV_SHOW);
    const t2 = (fresh.match(/name="search\[_token\]"[^>]*value="([^"]+)"/) || [])[1] || token;
    form.set("search[_token]", t2);
    resp = await submit(cookie);
    body = await resp.text();
  }
}

function buildFeedBody(start: number): URLSearchParams {
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
  return body;
}

async function fetchFeedPage(start: number): Promise<Array<Record<string, unknown>>> {
  const resp = await postSessioned<LeadsDataResponse>(ADV_FEED, buildFeedBody(start), {
    referer: ADV_SHOW,
  });
  return resp.aaData ?? resp.data ?? [];
}

/**
 * Pull every lead row across ALL statuses (incl. Customer) via Advanced Search.
 * READ-ONLY. Sets the session criteria once, then pages the feed.
 */
export async function fetchAllLeads(): Promise<Array<Record<string, unknown>>> {
  await setAdvancedSearchCriteria();
  const all: Array<Record<string, unknown>> = [];
  for (let start = 0; start < 60_000; start += PAGE_SIZE) {
    const rows = await fetchFeedPage(start);
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
