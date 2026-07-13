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
 *  - MISSING TAGS  = ALL currently-Active customers carrying NO CURRENT_YEAR tag
 *                    (any prior tags or none) — the full off-bucket active set
 *                    that needs a tag applied for this season. Supersedes the
 *                    narrower CUSTOMERS WITH ISSUES roster below (which it fully
 *                    contains).
 *  - CUSTOMERS WITH ISSUES = the subset of MISSING TAGS with NO PRIOR_YEAR tag
 *                    either — odd edge cases with no year history at all. Still
 *                    computed for continuity; the UI now shows MISSING TAGS and
 *                    flags this subset inline.
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

export interface MissingTagCustomer {
  id: string;
  name: string;
  /** All tags on the customer (sorted), or [] if none. */
  tags: string[];
  /** Last service date, ISO "YYYY-MM-DD", or null. */
  lastServiceDate: string | null;
  /** True if they carry a PRIOR_YEAR tag (Not-Renewed); false = also no prior tag (the old "issues"). */
  hadPriorYearTag: boolean;
}

/**
 * Return-rate "real customer" rule — ops-canonical (2026-07-13; replaces the
 * MIN_RETURN_TREATMENTS=2 threshold).
 *
 *   A customer is a "real customer of year Y" iff they received >= 1 COMPLETED
 *   mosquito-family service in Y (Event Spray NEVER counts — separate contract),
 *   EXCEPT a customer whose ONLY Y spray landed AFTER Aug 15 of Y. That single
 *   late spray is an extended-season one-off sale, not a real customer.
 *
 * The SAME test defines both the denominator (real year-Y customer) and the
 * numerator (returned = real customer of Y+1). Counts + the earliest spray date
 * per year come from the service-count cache (lib/service/serviceCounts.ts),
 * which reads each customer's mosquito service-history; Event Spray lives on a
 * separate contract and never lands there, so it can never count.
 *
 * LATE_SEASON_CUTOFF is a month/day (year-relative — applied against whichever
 * year Y is under test, never hardcoded to a specific calendar year).
 */
export const LATE_SEASON_CUTOFF = { month: 8, day: 15 } as const; // Aug 15
export const LATE_SEASON_CUTOFF_LABEL = "Aug 15";

/**
 * Is an earliest-spray ISO date ("YYYY-MM-DD") strictly after LATE_SEASON_CUTOFF
 * of its own year? (Used only for single-spray customers: their one spray IS the
 * earliest.) Month/day comparison — year-agnostic.
 */
function isLateSeasonSpray(iso: string): boolean {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return false;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  if (mm !== LATE_SEASON_CUTOFF.month) return mm > LATE_SEASON_CUTOFF.month;
  return dd > LATE_SEASON_CUTOFF.day;
}

/**
 * Coverage below this % keeps the card in a "(computing — N% covered)" state:
 * the per-customer service-count scrape is resumable and may still be filling.
 */
export const RETURN_RATE_MIN_COVERAGE_PCT = 99;

export interface ReturnRatePair {
  fromYear: string;
  toYear: string;
  /** Denominator: real customers of {fromYear} (>=1 completed mosquito service, late one-off excluded). */
  realFrom: number;
  /** Numerator: of those, real customers of {toYear} (same rule). */
  returned: number;
  /** returned / realFrom, percent. */
  rate: number;
  /** Single-late-spray customers excluded from {fromYear}'s denominator by the late-one-off carve-out. */
  excludedLateFrom: number;
  /** Single-late-spray customers excluded from {toYear}'s numerator test. */
  excludedLateTo: number;
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
  /** The late-season one-off cutoff in effect (surfaced on the card), e.g. "Aug 15". */
  lateSeasonCutoff: string;
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
  /** Active, no CURRENT_YEAR tag, no PRIOR_YEAR tag. Kept for continuity; the
   *  UI now surfaces the broader `missingTags` roster (which absorbs this). */
  issues: IssueCustomer[];
  issuesCount: number;
  /** ALL active customers with NO CURRENT_YEAR tag (superset of `issues` — also
   *  includes Not-Renewed-active who DO carry a prior-year tag). */
  missingTags: MissingTagCustomer[];
  missingTagsCount: number;
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

/** Trim a Pocomos date ("YYYY-MM-DD HH:MM:SS" or null) to an ISO "YYYY-MM-DD" or null. */
function isoDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Year-over-year mosquito return rate (ops-canonical, 2026-07-13 — >=1 completed
 * service with a late-one-off carve-out; supersedes the rev-15 ">=2 services"
 * threshold):
 *   "of the REAL customers of year Y, how many were REAL customers of year Y+1?"
 *
 * Real customer of Y = >= 1 completed mosquito service in Y (Event Spray EXCLUDED),
 * EXCEPT a customer whose ONLY Y spray landed after LATE_SEASON_CUTOFF (Aug 15) —
 * a late one-off, not a real customer. The SAME test drives the denominator (real
 * customer of Y) and the numerator (returned = real customer of Y+1), against the
 * per-year service-count cache (`mosquito_service_counts` + first-spray dates,
 * filled by lib/service/serviceCounts.ts from each customer's mosquito
 * service-history). Event Spray lives on a separate contract and never lands on
 * the mosquito table, so it can never contribute a count.
 *
 * Only cohort members scraped with table_ok (their mosquito contract's history
 * was actually read) are eligible; the rest are unknown and reflected in the
 * coverage %. While coverage < RETURN_RATE_MIN_COVERAGE_PCT the card shows
 * "(computing — N% covered)" because the resumable scrape is still filling.
 *
 * NOTE the CURRENT year (CY) is an in-progress season, so its numerator grows as
 * the season runs. READ-ONLY.
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

  // Real customer of year Y = scraped with a readable mosquito table AND >= 1
  // completed mosquito service in Y, UNLESS the only Y spray is a late one-off
  // (single spray after LATE_SEASON_CUTOFF). Returns false when the member isn't
  // table_ok (counts unknown) or has no Y service.
  const isReal = (id: string, y: number): boolean => {
    if (!data.tableOk.has(id)) return false;
    const count = data.counts.get(id)?.[y] ?? 0;
    if (count < 1) return false;
    if (count >= 2) return true; // more than one spray → not a one-off
    const first = data.firstDates.get(id)?.[y]; // single spray → its date
    return first ? !isLateSeasonSpray(first) : true;
  };

  // A single-late-spray customer for year Y: exactly one Y spray, after the
  // cutoff — counted so we can report how many the carve-out excludes.
  const isSingleLate = (id: string, y: number): boolean => {
    if (!data.tableOk.has(id)) return false;
    if ((data.counts.get(id)?.[y] ?? 0) !== 1) return false;
    const first = data.firstDates.get(id)?.[y];
    return first ? isLateSeasonSpray(first) : false;
  };

  const pairs: ReturnRatePair[] = [];
  for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    let realFrom = 0;
    let returned = 0;
    let excludedLateFrom = 0;
    let excludedLateTo = 0;
    for (const id of cohortIds) {
      if (isSingleLate(id, fromN)) excludedLateFrom++;
      if (isSingleLate(id, toN)) excludedLateTo++;
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
      excludedLateFrom,
      excludedLateTo,
      // Only the prior→current pair is inside the service-history window; older
      // from-years are truncated (see ReturnRatePair.reliable / §5.8).
      reliable: fromN >= cy - 1,
    });
  }

  return {
    pairs,
    lateSeasonCutoff: LATE_SEASON_CUTOFF_LABEL,
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
  const missingTags: MissingTagCustomer[] = [];
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    activeIds.add(String(c.id));
    const tags = c.tags;
    if (hasYearTag(tags, cy)) continue; // belongs to NEW / RETURNING / RETAINED
    // Active with NO current-year tag = "Missing tags" (the full off-bucket set).
    const sortedTags = [...tags].sort();
    const hadPriorYearTag = hasYearTag(tags, py);
    missingTags.push({
      id: String(c.id),
      name: c.fullName,
      tags: sortedTags,
      lastServiceDate: isoDateOnly(c.lastServiceDate),
      hadPriorYearTag,
    });
    if (hadPriorYearTag) {
      notRenewedActive++;
    } else {
      // Narrower legacy "issues" subset: no current-year AND no prior-year tag.
      issues.push({ id: String(c.id), name: c.fullName, tags: sortedTags });
    }
  }
  issues.sort((a, b) => a.name.localeCompare(b.name));
  // Most-recently-serviced first (undated last), then name.
  missingTags.sort(
    (a, b) =>
      (b.lastServiceDate ?? "").localeCompare(a.lastServiceDate ?? "") ||
      a.name.localeCompare(b.name)
  );

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
    missingTags,
    missingTagsCount: missingTags.length,
    enrichedNonActive: rows.length,
    returnRates,
    asOf: new Date().toISOString(),
  };
}
