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

export interface IssueCustomer {
  id: string;
  name: string;
  tags: string[];
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
    SELECT pocomos_id, status, tags, last_service_date
    FROM customers WHERE lower(status) <> 'active'
  `) as Array<{
    pocomos_id: string;
    status: string;
    tags: unknown;
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
    asOf: new Date().toISOString(),
  };
}
