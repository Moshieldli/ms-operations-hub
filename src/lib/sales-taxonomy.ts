import { getDataset } from "@/lib/pocomos";
import { CURRENT_YEAR } from "@/lib/pocomos";
import { initSchema, sql } from "@/lib/db";
import { buildServiceCountCohort, getServiceCountsData } from "@/lib/service/serviceCounts";

/**
 * Year-relative cancelled taxonomy + "customers with issues" roster for /sales.
 *
 * Everything is computed from CURRENT_YEAR (= new Date().getFullYear()) and
 * PRIOR_YEAR (CURRENT_YEAR - 1) — never hardcoded — so it stays correct across
 * the Jan-1 rollover.
 *
 * Definitions (all by year-tag presence; a "{YYYY} -" tag means the customer
 * had service that year):
 *  - NOT RENEWED   = customers (any status) with a PRIOR_YEAR tag but NO
 *                    CURRENT_YEAR tag — last season's customers who haven't
 *                    signed up this season. Mostly Inactive records.
 *  - CANCELLED – ALL TIME = currently-Inactive customers NOT in the Not-Renewed
 *                    group (cancelled in an earlier season). Headline count is
 *                    derived from the live Inactive total minus the Not-Renewed
 *                    Inactive carve-out; the relative year breakdown is by last
 *                    service date.
 *  - CUSTOMERS WITH ISSUES = currently-Active customers carrying NO CURRENT_YEAR
 *                    tag AND NO PRIOR_YEAR tag — the odd edge cases that don't
 *                    fit any bucket and need eyeballing.
 *
 * Active-customer tags come from the live dataset (getDataset, 10-min cached).
 * Non-active tags come from the enriched `customers` Neon table (overnight
 * enrichment fills tags for Inactive/On-Hold). READ-ONLY against Pocomos.
 */

const PRIOR_YEAR = String(Number(CURRENT_YEAR) - 1);

export interface IssueCustomer {
  id: string;
  name: string;
  tags: string[];
}

/**
 * MIN_RETURN_TREATMENTS — ops-canonical (2026-07-08): a customer counts as a
 * "real year-Y mosquito customer" (denominator) AND as "returned in year Y"
 * (numerator) only if they received at least this many COMPLETED mosquito-family
 * services (Event Spray EXCLUDED) in that calendar year. Rationale: a return is
 * someone who actually came back for treatment — not a tag, and not a one-off
 * (a single spray). 2 = at least one real repeat visit. Counts come from the
 * per-year service-count cache (lib/service/serviceCounts.ts), which reads the
 * mosquito contract's completed-services history (Event Spray lives on a
 * separate contract and never lands there, so it can never count).
 */
export const MIN_RETURN_TREATMENTS = 2;

/**
 * Coverage below this % keeps the card in a "(computing — N% covered)" state:
 * the per-customer service-count scrape is resumable and may still be filling.
 */
export const RETURN_RATE_MIN_COVERAGE_PCT = 99;

export interface ReturnRatePair {
  fromYear: string;
  toYear: string;
  /** Denominator: customers with >= MIN_RETURN_TREATMENTS completed mosquito services in {fromYear}. */
  realFrom: number;
  /** Numerator: of those, customers with >= MIN_RETURN_TREATMENTS completed mosquito services in {toYear}. */
  returned: number;
  /** returned / realFrom, percent. */
  rate: number;
  /**
   * False when {fromYear} falls OUTSIDE the service-history window. The Pocomos
   * service-history table only renders the most recent ~30 services (back to
   * ~Sept of the prior year), so a customer still active this season has their
   * two-years-ago services truncated away — `realFrom` for that year collapses
   * and the rate is meaningless. Only {fromYear} >= CY-1 is reliable. The 24→25
   * pair needs a full-history source (see §5.8 / BACKLOG) before it's valid.
   */
  reliable: boolean;
}

export interface ReturnRates {
  /** Ordered oldest→newest: [(CY-2 → CY-1), (CY-1 → CY)]. */
  pairs: ReturnRatePair[];
  /** The MIN_RETURN_TREATMENTS threshold in effect (surfaced on the card). */
  minTreatments: number;
  /** Cohort size (mosquito customers with a {CY-2..CY} tag) — the scrape target. */
  cohortSize: number;
  /** Cohort members whose service history has been scraped (coverage numerator). */
  covered: number;
  /** covered / cohortSize, percent (0–100). */
  coveragePct: number;
  /** True while coverage < RETURN_RATE_MIN_COVERAGE_PCT — show "(computing)". */
  computing: boolean;
}

export interface CancelledBreakdownRel {
  thisYear: number;
  lastYear: number;
  earlier: number;
  unknown: number;
}

export interface SalesTaxonomy {
  year: string;
  priorYear: string;
  /** Had a PRIOR_YEAR tag, no CURRENT_YEAR tag (any status). */
  notRenewed: number;
  notRenewedActive: number;
  notRenewedInactive: number;
  /** Inactive minus the Not-Renewed inactive carve-out. */
  cancelledAllTime: number;
  cancelled: CancelledBreakdownRel;
  /** Active, no CURRENT_YEAR tag, no PRIOR_YEAR tag. */
  issues: IssueCustomer[];
  issuesCount: number;
  /** Telemetry: enriched non-active rows available for the tag carve. */
  enrichedNonActive: number;
  /** Year-over-year mosquito return rates (24→25, 25→26). */
  returnRates: ReturnRates;
  asOf: string;
}

function hasYearTag(tags: string[], year: string): boolean {
  const prefix = `${year} -`;
  return tags.some((t) => String(t).trim().startsWith(prefix));
}

function yearOf(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Year-over-year mosquito return rate (ops-canonical, 2026-07-08 — service-count
 * based; supersedes the earlier tag/last-service model):
 *   "of customers who received >= MIN_RETURN_TREATMENTS completed mosquito
 *    services (Event Spray EXCLUDED) in year Y, how many received >=
 *    MIN_RETURN_TREATMENTS completed mosquito services in year Y+1?"
 *
 * A "return" is thus a real treatment history — not a tag, not a one-off spray.
 * Both the denominator (real year-Y customer) and numerator (returned in Y+1)
 * use the SAME test against the per-year service-count cache
 * (`mosquito_service_counts`, filled by lib/service/serviceCounts.ts from each
 * customer's mosquito service-history). Event Spray lives on a separate contract
 * and never lands on the mosquito table, so it can never contribute a count.
 *
 * Only cohort members scraped with table_ok (their mosquito contract's history
 * was actually read) are eligible; the rest are unknown and reflected in the
 * coverage %. While coverage < RETURN_RATE_MIN_COVERAGE_PCT the card shows
 * "(computing — N% covered)" because the resumable scrape is still filling.
 *
 * NOTE the CURRENT year (CY) is an in-progress season, so its numerator grows as
 * the season runs (a customer needs 2 completed CY services so far to count).
 * READ-ONLY.
 */
async function computeReturnRates(): Promise<ReturnRates> {
  const cy = Number(CURRENT_YEAR);
  const [cohort, data] = await Promise.all([
    buildServiceCountCohort(),
    getServiceCountsData(),
  ]);
  const cohortIds = cohort.map((m) => m.id);

  let covered = 0;
  for (const id of cohortIds) if (data.scraped.has(id)) covered++;
  const coveragePct = cohort.length ? Math.round((covered / cohort.length) * 1000) / 10 : 0;

  // Real year-Y mosquito customer = scraped with a readable mosquito table AND
  // >= MIN_RETURN_TREATMENTS completed mosquito services counted that year.
  const isReal = (id: string, y: number): boolean =>
    data.tableOk.has(id) && (data.counts.get(id)?.[y] ?? 0) >= MIN_RETURN_TREATMENTS;

  const pairs: ReturnRatePair[] = [];
  for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    let realFrom = 0;
    let returned = 0;
    for (const id of cohortIds) {
      if (!isReal(id, fromN)) continue;
      realFrom++;
      if (isReal(id, toN)) returned++;
    }
    pairs.push({
      fromYear: String(fromN),
      toYear: String(toN),
      realFrom,
      returned,
      rate: realFrom ? (returned / realFrom) * 100 : 0,
      // Only the prior→current pair is inside the service-history window; older
      // from-years are truncated (see ReturnRatePair.reliable / §5.8).
      reliable: fromN >= cy - 1,
    });
  }

  return {
    pairs,
    minTreatments: MIN_RETURN_TREATMENTS,
    cohortSize: cohort.length,
    covered,
    coveragePct,
    computing: coveragePct < RETURN_RATE_MIN_COVERAGE_PCT,
  };
}

export async function getSalesTaxonomy(): Promise<SalesTaxonomy> {
  await initSchema();
  const ds = await getDataset();
  const cy = CURRENT_YEAR;
  const py = PRIOR_YEAR;
  const cyNum = Number(cy);

  // ---- Active side (live dataset has per-active tags) ----
  const activeIds = new Set<string>();
  let notRenewedActive = 0;
  const issues: IssueCustomer[] = [];
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    activeIds.add(String(c.id));
    const tags = c.tags;
    if (hasYearTag(tags, cy)) continue; // belongs to NEW / RETURNING / RETAINED
    if (hasYearTag(tags, py)) {
      notRenewedActive++;
    } else {
      issues.push({ id: String(c.id), name: c.fullName, tags: [...tags].sort() });
    }
  }
  issues.sort((a, b) => a.name.localeCompare(b.name));

  // ---- Non-active side (enriched tags from the customers table) ----
  const rows = (await sql`
    SELECT pocomos_id, status, tags, contracts, last_service_date
    FROM customers WHERE lower(status) <> 'active'
  `) as Array<{
    pocomos_id: string;
    status: string;
    tags: unknown;
    contracts: unknown;
    last_service_date: string | null;
  }>;

  let notRenewedNonActive = 0;
  let notRenewedInactiveStatus = 0;
  let cThis = 0;
  let cLast = 0;
  let cEarlier = 0;
  for (const r of rows) {
    // A customer that has since re-activated is counted on the active side.
    if (activeIds.has(String(r.pocomos_id))) continue;
    const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
    const isNotRenewed = hasYearTag(tags, py) && !hasYearTag(tags, cy);
    const isInactive = r.status.toLowerCase() === "inactive";
    if (isNotRenewed) {
      notRenewedNonActive++;
      if (isInactive) notRenewedInactiveStatus++;
      continue; // Not-Renewed is carved out of Cancelled – All Time
    }
    // Cancelled subset: inactive, not Not-Renewed → tally by last service year.
    if (isInactive) {
      const y = yearOf(r.last_service_date);
      if (y === cyNum) cThis++;
      else if (y === cyNum - 1) cLast++;
      else if (y != null) cEarlier++;
      // null/undated falls into the unknown remainder below
    }
  }

  const totalInactive = ds.diagnostics.inactiveCount;
  const cancelledAllTime = Math.max(0, totalInactive - notRenewedInactiveStatus);
  // `unknown` absorbs undated + any not-yet-enriched inactive rows so the
  // breakdown always sums to the headline count.
  const unknown = Math.max(0, cancelledAllTime - (cThis + cLast + cEarlier));

  const returnRates = await computeReturnRates();

  return {
    year: cy,
    priorYear: py,
    notRenewed: notRenewedActive + notRenewedNonActive,
    notRenewedActive,
    notRenewedInactive: notRenewedNonActive,
    cancelledAllTime,
    cancelled: { thisYear: cThis, lastYear: cLast, earlier: cEarlier, unknown },
    issues,
    issuesCount: issues.length,
    enrichedNonActive: rows.length,
    returnRates,
    asOf: new Date().toISOString(),
  };
}
