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
 * Return-rate "real customer" rule — ops-canonical (rev 17, 2026-07-16).
 *
 *   A customer is a "real customer of year Y" iff EITHER
 *     (a) they received >= REAL_CUSTOMER_MIN_SERVICES (2) COMPLETED
 *         mosquito-family services in Y, OR
 *     (b) they received exactly 1, and its date falls AFTER LATE_SEASON_CUTOFF
 *         (Aug 15) of Y — a LATE-SEASON SIGNUP: they joined too late in the
 *         season to have received more than one spray, so their single spray is
 *         evidence of a real customer, not of a one-off.
 *   A single EARLY/MID-season spray (on or before the cutoff) does NOT qualify:
 *   a customer who had the whole season available and took one spray is a
 *   one-off, not a real customer.
 *
 *   Event Spray NEVER counts — it is a separate Pocomos contract and never lands
 *   on the mosquito contract's service-history table.
 *
 * ⚠ This REVERSES the rev-16 carve-out, which excluded a single LATE spray and
 * accepted a single early one. Ops confirmed the opposite is the real signal:
 * lateness EXPLAINS a low spray count rather than discrediting it.
 *
 * This rule alone defines the return-rate DENOMINATOR (real customers of Y).
 * The NUMERATOR and the /sales "Returning" box additionally accept a
 * continuation-tag path — see `hasContinuationTag` / `computeReturnRatesAndBox`.
 *
 * Counts + the per-year first-spray date come from the service-count cache
 * (lib/service/serviceCounts.ts), which reads each customer's mosquito
 * service-history.
 *
 * LATE_SEASON_CUTOFF is a month/day (year-relative — applied against whichever
 * year Y is under test, never hardcoded to a specific calendar year).
 */
export const LATE_SEASON_CUTOFF = { month: 8, day: 15 } as const; // Aug 15
export const LATE_SEASON_CUTOFF_LABEL = "Aug 15";
export const REAL_CUSTOMER_MIN_SERVICES = 2;

/**
 * Continuation tags that mark a customer's service as having rolled into year Y
 * (ops list: Auto / SEB / EB / Renewed). `Prepaid` / `Committed` are also
 * continuation tags in categorize.ts's bucket logic and are accepted here so the
 * two never silently disagree — as of 2026-07-16 ZERO customers carry either
 * without also carrying one of the four named tags, so including them changes no
 * count today (probe: scripts/probe-return-unification.ts).
 *
 * The four NAMED tags drive the Returning box's sub-counts, in this precedence
 * order (a customer can hold several; each is counted once).
 */
export const CONTINUATION_TAGS_NAMED = ["Auto", "SEB", "EB", "Renewed"] as const;
const CONTINUATION_TAGS_ALL = [...CONTINUATION_TAGS_NAMED, "Prepaid", "Committed"] as const;

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
  /** Denominator: real customers of {fromYear} (rule 1 — sprays only, no tag path). */
  realFrom: number;
  /** Numerator: of those, real customers of {toYear} OR holding a {toYear} continuation tag while active. */
  returned: number;
  /** returned / realFrom, percent. */
  rate: number;
  /** Of `returned`: qualified by {toYear} spray history (rule 1), with no continuation tag. */
  returnedBySprayHistory: number;
  /** Of `returned`: qualified by a {toYear} continuation tag (may also have sprays). */
  returnedByTag: number;
  /** Single LATE-season sprayers who QUALIFY as real {fromYear} customers (rule 1b). */
  lateSignupsFrom: number;
  /** Single LATE-season sprayers who qualify as real {toYear} customers (rule 1b). */
  lateSignupsTo: number;
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

/**
 * The /sales "Returning" box (rev 17) — UNIFIED with the return-rate numerator.
 *
 * Members = real customers of PRIOR_YEAR (rule 1) who RETURNED into CURRENT_YEAR
 * (rule 2: real customer of CY by spray history, OR an active customer holding a
 * CY continuation tag). This is EXACTLY the CY-1 → CY numerator set, so the two
 * cards on /sales can never disagree: `total` === that pair's `returned`.
 *
 * Before rev 17 this box was a pure tag count (active + any CY continuation tag,
 * no CY New Sale = categorize.ts's RETAINED bucket), which answered a different
 * question than the return rate and read ~33 higher.
 *
 * Sub-counts partition `total`: a member with a continuation tag is counted under
 * its highest-precedence named tag; a member who qualified only through spray
 * history falls into `bySprayHistory`.
 */
export interface ReturningBox {
  /** Prior-year real customers who returned. === the CY-1→CY pair's `returned`. */
  total: number;
  auto: number;
  seb: number;
  eb: number;
  renewed: number;
  /** Qualified via CY spray history with NO continuation tag. */
  bySprayHistory: number;
  /**
   * Denominator context: real customers of PRIOR_YEAR (the box's universe).
   * total / priorYearReal === the CY-1→CY return rate.
   */
  priorYearReal: number;
  /** Members NOT currently Active in Pocomos (qualified purely on CY sprays). */
  nonActive: number;
}

export interface ReturnRates {
  /** Ordered oldest→newest: [(CY-2 → CY-1), (CY-1 → CY)]. */
  pairs: ReturnRatePair[];
  /** The late-season signup cutoff in effect (surfaced on the card), e.g. "Aug 15". */
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
  /** The /sales "Returning" box — unified with the CY-1→CY numerator (rev 17). */
  returningBox: ReturningBox;
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
 * Year-over-year mosquito return rate + the unified "Returning" box
 * (ops-canonical, rev 17, 2026-07-16):
 *   "of the REAL customers of year Y, how many RETURNED in year Y+1?"
 *
 * DENOMINATOR — real customers of Y (rule 1, sprays only, NO tag path):
 *   >= REAL_CUSTOMER_MIN_SERVICES (2) completed mosquito services in Y, OR
 *   exactly 1 whose date is AFTER LATE_SEASON_CUTOFF (a late-season signup).
 *   Event Spray never counts (separate contract, never on the mosquito table).
 *
 * NUMERATOR — returned in Y+1 (rule 2, the COMBINED definition):
 *   a real customer of Y+1 by rule 1, OR an ACTIVE customer carrying a Y+1
 *   continuation tag (Auto/SEB/EB/Renewed). The tag path catches customers whose
 *   service has rolled into the new season but who haven't been sprayed yet —
 *   without it, an in-progress season understates returns. The tag path requires
 *   ACTIVE status so a cancelled customer's stale auto-renew tag can't count as a
 *   return (the rev-14 bug).
 *
 * RETURNING BOX = the numerator set itself (see `ReturningBox`), so the /sales
 * "Returning" tile and the return-rate card are the same population by
 * construction — box.total === the CY-1→CY pair's `returned`.
 *
 * Counts come from the per-year service-count cache (`mosquito_service_counts` +
 * first-spray dates, filled by lib/service/serviceCounts.ts). Only cohort members
 * scraped with table_ok (their mosquito contract's history was actually read) can
 * qualify by spray history; the rest are reflected in the coverage %. While
 * coverage < RETURN_RATE_MIN_COVERAGE_PCT the card shows "(computing — N%)".
 *
 * NOTE the CURRENT year (CY) is an in-progress season, so its numerator grows as
 * the season runs. READ-ONLY.
 */
async function computeReturnRatesAndBox(): Promise<{
  returnRates: ReturnRates;
  returningBox: ReturningBox;
}> {
  const cy = Number(CURRENT_YEAR);
  const [cohort, data] = await Promise.all([
    buildServiceCountCohort(),
    getServiceCountsData(),
  ]);
  const byId = new Map(cohort.map((m) => [m.id, m]));

  // UNIVERSE (rev 18) = the tag-based scrape cohort PLUS every customer the bulk
  // exports know about. The cohort alone requires a mosquito contract carrying a
  // {CY-2..CY} tag, which silently drops customers who churned after their
  // season — exactly the population a return-rate DENOMINATOR is made of.
  const universe = new Set<string>(cohort.map((m) => m.id));
  for (const id of data.counts.keys()) universe.add(id);
  const universeIds = [...universe];

  let covered = 0;
  for (const m of cohort) if (data.scraped.has(m.id)) covered++;
  const coveragePct = cohort.length ? Math.round((covered / cohort.length) * 1000) / 10 : 0;

  /**
   * Is year Y export-backed (authoritative), or scrape-backed?
   * Export years need NO scrape-coverage gate: the export covers every customer
   * and every contract, so a missing row is a true zero. Scrape years keep the
   * table_ok gate — an unreadable mosquito table means counts are unknown, not
   * zero, so those customers must fail closed.
   */
  const isExportYear = (y: number) => data.exportYears.has(y);
  const countsKnown = (id: string, y: number): boolean =>
    isExportYear(y) || data.tableOk.has(id);

  const sprayCount = (id: string, y: number): number =>
    countsKnown(id, y) ? data.counts.get(id)?.[y] ?? 0 : 0;

  // Rule 1 — real customer of Y by SPRAY HISTORY alone.
  const isReal = (id: string, y: number): boolean => {
    if (!countsKnown(id, y)) return false;
    const count = sprayCount(id, y);
    if (count >= REAL_CUSTOMER_MIN_SERVICES) return true;
    if (count !== 1) return false;
    // Exactly one spray: real ONLY if it landed after the cutoff (late-season
    // signup — too late in the season to have had a second spray).
    const first = data.firstDates.get(id)?.[y]; // single spray → its date
    return first ? isLateSeasonSpray(first) : false;
  };

  // A single LATE-season sprayer for year Y — qualifies via rule 1b. Reported so
  // the card can show how many of the real customers came in that way.
  const isLateSignup = (id: string, y: number): boolean =>
    sprayCount(id, y) === 1 && isReal(id, y);

  /**
   * Rule 2's tag path — an ACTIVE customer whose service rolled into year Y.
   *
   * ONLY applies to the IN-PROGRESS season (rev 18). The tag path exists to
   * rescue customers whose service has rolled over but who simply haven't been
   * sprayed YET; that can only be true of the season we're living in. For a
   * COMPLETED, export-backed season the spray record is final and complete, so a
   * customer with a continuation tag but no sprays genuinely did not get served
   * — counting their tag would resurrect the exact stale-tag bug (rev 14) the
   * active-status check was added to kill.
   */
  const tagPathApplies = (y: number) => y === cy && !isExportYear(y);
  const hasContinuationTag = (id: string, y: number): boolean => {
    if (!tagPathApplies(y)) return false;
    const m = byId.get(id);
    if (!m || !m.active) return false; // stale tag on a cancelled customer ≠ return
    const tags = new Set(m.tags);
    return CONTINUATION_TAGS_ALL.some((t) => tags.has(`${y} - ${t}`));
  };

  // Rule 2 — RETURNED in year Y: real by sprays, OR (in-progress season only) an
  // active customer carrying a Y continuation tag.
  const hasReturned = (id: string, y: number): boolean =>
    isReal(id, y) || hasContinuationTag(id, y);

  const pairs: ReturnRatePair[] = [];
  for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    let realFrom = 0;
    let returned = 0;
    let returnedBySprayHistory = 0;
    let returnedByTag = 0;
    let lateSignupsFrom = 0;
    let lateSignupsTo = 0;
    for (const id of universeIds) {
      if (isLateSignup(id, fromN)) lateSignupsFrom++;
      if (isLateSignup(id, toN)) lateSignupsTo++;
      if (!isReal(id, fromN)) continue; // denominator = rule 1 only
      realFrom++;
      if (!hasReturned(id, toN)) continue;
      returned++;
      if (hasContinuationTag(id, toN)) returnedByTag++;
      else returnedBySprayHistory++;
    }
    pairs.push({
      fromYear: String(fromN),
      toYear: String(toN),
      realFrom,
      returned,
      rate: realFrom ? (returned / realFrom) * 100 : 0,
      returnedBySprayHistory,
      returnedByTag,
      lateSignupsFrom,
      lateSignupsTo,
      /**
       * Reliable once the FROM-year has an authoritative source. Both completed
       * seasons are now export-backed (2024 RealGreen, 2025 Pocomos), so both
       * pairs are live — this replaces the rev-17 `fromN >= cy-1` guard, which
       * existed only because the scrape's service-history window truncated
       * anything older than ~1 season.
       */
      reliable: isExportYear(fromN) || fromN >= cy - 1,
    });
  }

  // ---- Returning box: the CY-1 → CY numerator set, with sub-counts ----
  const box: ReturningBox = {
    total: 0,
    auto: 0,
    seb: 0,
    eb: 0,
    renewed: 0,
    bySprayHistory: 0,
    priorYearReal: 0,
    nonActive: 0,
  };
  for (const id of universeIds) {
    if (!isReal(id, cy - 1)) continue;
    box.priorYearReal++;
    if (!hasReturned(id, cy)) continue;
    box.total++;
    const m = byId.get(id);
    if (!m?.active) box.nonActive++;
    if (hasContinuationTag(id, cy)) {
      // Precedence mirrors CONTINUATION_TAGS_NAMED; each member counted once.
      const tags = new Set(m?.tags ?? []);
      const named = CONTINUATION_TAGS_NAMED.find((t) => tags.has(`${cy} - ${t}`));
      if (named === "Auto") box.auto++;
      else if (named === "SEB") box.seb++;
      else if (named === "EB") box.eb++;
      else if (named === "Renewed") box.renewed++;
      // No named tag → qualified on Prepaid/Committed alone (zero today); count
      // it with the spray-history remainder so the sub-counts always sum.
      else box.bySprayHistory++;
    } else {
      box.bySprayHistory++;
    }
  }

  return {
    returnRates: {
      pairs,
      lateSeasonCutoff: LATE_SEASON_CUTOFF_LABEL,
      cohortSize: cohort.length,
      covered,
      coveragePct,
      computing: coveragePct < RETURN_RATE_MIN_COVERAGE_PCT,
    },
    returningBox: box,
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

  const { returnRates, returningBox } = await computeReturnRatesAndBox();

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
    returningBox,
    asOf: new Date().toISOString(),
  };
}
