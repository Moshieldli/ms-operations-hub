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
  /** Denominator (primary): real {fromYear} customers (mosquito contract + {fromYear} tag). */
  realFrom: number;
  /** Numerator: real {fromYear} customers who genuinely returned as real {toYear} customers. */
  returned: number;
  /** returned / realFrom, percent. */
  rate: number;
  /** Mid-season {fromYear} cancels removed for the excl variant (inactive, last service in {fromYear}, didn't return). */
  midSeasonCancels: number;
  /** Denominator excluding mid-season cancels = realFrom - midSeasonCancels. */
  exclDenom: number;
  /** returned / exclDenom, percent. */
  exclRate: number;
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
 * Year-over-year mosquito return rate. A "real year-Y customer" = holds a
 * mosquito-family contract (excl. Event Spray) whose OWN tags carry a "{Y} -"
 * season tag — tag alone is NOT enough, there must be a mosquito contract.
 *
 * "Returned" applies the status/deactivation guard to the destination year so a
 * mid-season cancel doesn't count as a return: realValidated(Y) = real(Y) AND
 * NOT (inactive now with last service in Y). Active customers are never
 * mid-season cancels; auto-renewing mosquito contracts accumulate each season's
 * tag on one contract, so a single contract can be real across several years.
 *
 * Denominator has two variants (pending an ops decision on which is canonical):
 *   primary  = all real {from} customers (mid-season cancels count against you)
 *   exclDenom = real {from} minus mid-season {from} cancels
 * Both share the same numerator, and returned ⊆ exclDenom (a returner can't be a
 * mid-{from} cancel), so exclRate never exceeds 100%.
 *
 * Sources: active customers' contracts from the live dataset; non-active from
 * the enriched `customers` table (contracts jsonb). READ-ONLY.
 */
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

  const realStrict = (rec: RRRec, y: string) =>
    rec.contracts.some((c) => isMosquitoType(c.serviceType) && contractHasYearTag(c.tags, y));
  const isMidSeasonCancel = (rec: RRRec, y: string) =>
    rec.status === "inactive" && String(rec.lastService || "").slice(0, 4) === y;
  const realValidated = (rec: RRRec, y: string) => realStrict(rec, y) && !isMidSeasonCancel(rec, y);

  let eventSprayOnly = 0;
  for (const rec of recs.values()) {
    const hasMosq = rec.contracts.some((c) => isMosquitoType(c.serviceType));
    const hasEvent = rec.contracts.some((c) => isEventSprayType(c.serviceType));
    if (hasEvent && !hasMosq) eventSprayOnly++;
  }

  const cy = Number(CURRENT_YEAR);
  const pairs: ReturnRatePair[] = [];
  for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    const from = String(fromN);
    const to = String(toN);
    let realFrom = 0;
    let returned = 0;
    let exclDenom = 0;
    for (const rec of recs.values()) {
      if (!realStrict(rec, from)) continue;
      realFrom++;
      if (!isMidSeasonCancel(rec, from)) exclDenom++;
      if (realValidated(rec, to)) returned++;
    }
    pairs.push({
      fromYear: from,
      toYear: to,
      realFrom,
      returned,
      rate: realFrom ? (returned / realFrom) * 100 : 0,
      midSeasonCancels: realFrom - exclDenom,
      exclDenom,
      exclRate: exclDenom ? (returned / exclDenom) * 100 : 0,
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
