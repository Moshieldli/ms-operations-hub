import { getDataset } from "@/lib/pocomos";
import { CURRENT_YEAR } from "@/lib/pocomos";
import { initSchema, sql } from "@/lib/db";

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

// ---- Return-rate helpers (mosquito-family detection, excluding Event Spray) ----
// Same set as lib/service/mosquito.ts MOSQUITO_SERVICE_TYPES. Event Spray is
// deliberately NOT in here, so an event-spray-only customer never counts.
const MOSQUITO_SERVICE_TYPES = new Set(
  [
    "Mosquito Control",
    "Natural Mosquito Control",
    "Mosquito Control - Weekly",
    "Natural Mosquito Control - Weekly",
  ].map((s) => s.toLowerCase())
);
const isMosquitoType = (s: unknown): boolean =>
  MOSQUITO_SERVICE_TYPES.has(String(s || "").trim().toLowerCase());
const isEventSprayType = (s: unknown): boolean => /event\s*spray/i.test(String(s || ""));
/** A contract's OWN per-contract tags carry the season enrollment (e.g. "2025 - Auto"). */
const contractHasYearTag = (tags: string[] | undefined, year: string): boolean =>
  (tags || []).some((t) => String(t).trim().startsWith(`${year} -`));

export interface IssueCustomer {
  id: string;
  name: string;
  tags: string[];
}

export interface ReturnRatePair {
  fromYear: string;
  toYear: string;
  /** Denominator: customers who received a completed mosquito service in {fromYear}. */
  realFrom: number;
  /** Numerator: of those, customers receiving a mosquito service in {toYear}. */
  returned: number;
  /** returned / realFrom, percent. */
  rate: number;
  /** Subset of `returned` that is currently On-Hold (counted per ops; paused ≠ cancelled). */
  onHoldReturned: number;
}

export interface ReturnRates {
  /** Ordered oldest→newest: [(CY-2 → CY-1), (CY-1 → CY)]. */
  pairs: ReturnRatePair[];
  /** Customers with an event-spray contract and NO mosquito-family contract (excluded from all counts). */
  eventSprayOnly: number;
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

interface RRContract {
  serviceType?: string | null;
  tags?: string[];
}
interface RRRec {
  status: string;
  contracts: RRContract[];
  lastService: string | null;
}

/**
 * Year-over-year mosquito return rate (ops definition, 2026-07-07):
 *   "of customers who received ≥1 completed mosquito service (not Event Spray)
 *    in year Y, how many are receiving a mosquito service in year Y+1?"
 *
 * `servedInYear(rec, Y)` decides real-customer membership from the best BULK
 * evidence, preferring completed-service signal over tags:
 *  - Identity + season: a mosquito-family contract (excl. Event Spray) whose OWN
 *    tags carry a "{Y} -" tag. Tags are the only bulk per-season signal, so they
 *    identify the mosquito contract and which seasons it was enrolled for.
 *  - Completed-service gate:
 *      · CURRENT (in-progress) season → the customer must still be LIVE (active,
 *        or On-Hold = paused, counted per ops). An inactive/cancelled customer is
 *        NOT receiving service, even if carrying an auto-renew tag. THIS is the
 *        bug fix: a "{CY} -" tag on a cancelled customer no longer counts.
 *      · COMPLETED past season → LIVE now (continuity proxy), OR direct evidence
 *        that their last service was in year Y or later (`last_service_date`).
 *        An inactive customer whose last service PRE-dates Y auto-renewed then
 *        cancelled before the season materialised → never got a Y service →
 *        excluded.
 *
 * Bulk-evidence limits (see REFERENCE §5.8): `last_service_date` is the MOST
 * RECENT service only and is any-type (not mosquito-specific). It confirms the
 * year of the last service (definitive YES for last-service==Y, definitive NO
 * for last-service<Y) but cannot confirm a specific past year's service for a
 * still-active customer whose last service is later — those rely on the season
 * tag as a continuity proxy. A literal per-year completed-mosquito-service count
 * would need a full service-history scrape of the cancelled cohort (not run).
 * Consequence: the CURRENT-year numerator (2026) is anchored on live status
 * (high confidence); the all-past-years rate (24→25) is a tag-anchored estimate.
 *
 * ON_HOLD_COUNTS: On-Hold customers count as served/returned (paused, not
 * cancelled). Impact is ~0.1–0.3pp; flip to test the sensitivity.
 *
 * Sources: active customers' contracts from the live dataset; non-active from
 * the enriched `customers` table (contracts jsonb). READ-ONLY.
 */
const ON_HOLD_COUNTS = true;

function computeReturnRates(
  ds: Awaited<ReturnType<typeof getDataset>>,
  nonActive: Array<{
    pocomos_id: string;
    status: string;
    contracts: unknown;
    last_service_date: string | null;
  }>
): ReturnRates {
  const recs = new Map<string, RRRec>();
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    recs.set(String(c.id), {
      status: "active",
      contracts: c.contracts.map((k) => ({ serviceType: k.serviceType, tags: k.tags })),
      lastService: c.lastServiceDate ?? null,
    });
  }
  for (const r of nonActive) {
    const id = String(r.pocomos_id);
    if (recs.has(id)) continue; // re-activated → counted on the active side
    const contracts = Array.isArray(r.contracts) ? (r.contracts as RRContract[]) : [];
    recs.set(id, {
      status: r.status.toLowerCase(),
      contracts,
      lastService: r.last_service_date,
    });
  }

  const cy = Number(CURRENT_YEAR);
  const hasMosquitoSeasonTag = (rec: RRRec, y: string) =>
    rec.contracts.some((c) => isMosquitoType(c.serviceType) && contractHasYearTag(c.tags, y));
  const isLive = (rec: RRRec) =>
    rec.status === "active" || (ON_HOLD_COUNTS && rec.status === "on-hold");
  const servedInYear = (rec: RRRec, y: string): boolean => {
    if (!hasMosquitoSeasonTag(rec, y)) return false;
    if (Number(y) >= cy) return isLive(rec); // in-progress season: must still be live
    if (isLive(rec)) return true; // completed season, still a customer (continuity)
    const ly = yearOf(rec.lastService); // or direct service-date evidence
    return ly != null && ly >= Number(y);
  };

  let eventSprayOnly = 0;
  for (const rec of recs.values()) {
    const hasMosq = rec.contracts.some((c) => isMosquitoType(c.serviceType));
    const hasEvent = rec.contracts.some((c) => isEventSprayType(c.serviceType));
    if (hasEvent && !hasMosq) eventSprayOnly++;
  }

  const pairs: ReturnRatePair[] = [];
  for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    const from = String(fromN);
    const to = String(toN);
    let realFrom = 0;
    let returned = 0;
    let onHoldReturned = 0;
    for (const rec of recs.values()) {
      if (!servedInYear(rec, from)) continue;
      realFrom++;
      if (servedInYear(rec, to)) {
        returned++;
        if (rec.status === "on-hold") onHoldReturned++;
      }
    }
    pairs.push({
      fromYear: from,
      toYear: to,
      realFrom,
      returned,
      rate: realFrom ? (returned / realFrom) * 100 : 0,
      onHoldReturned,
    });
  }
  return { pairs, eventSprayOnly };
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

  const returnRates = computeReturnRates(ds, rows);

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
