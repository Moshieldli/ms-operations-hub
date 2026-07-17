import { initSchema, sql } from "@/lib/db";

/**
 * Fleet counts for the public sheet feed (rev 23).
 *
 * Both numbers come straight from `mosquito_service_status` — the table the
 * nightly `/api/cron/mosquito-status` job rebuilds, and the exact eligible
 * population `/service/overdue` reports. So the feed is "cached, refreshed by
 * nightly jobs" by construction: it reads the nightly cache, no extra table.
 *
 *  - customer_total = every eligible mosquito customer we service (= the overdue
 *    page's "Eligible (mosquito)" total; all statuses, one row per customer).
 *  - service_total  = properties serviced per TWO-WEEK period: each customer
 *    once, EXCEPT Weekly-cadence contracts (agreement/service-frequency contains
 *    "Weekly", flagged `is_weekly`) which count TWICE. This is a VAN-CAPACITY
 *    gauge (a van does ≈ VAN_CAPACITY_PER_2WK properties / 2 weeks), not a count
 *    of services rendered.
 */

/** A van services roughly this many properties per two-week cycle. */
export const VAN_CAPACITY_PER_2WK = 250;

export interface FleetCounts {
  customerTotal: number;
  serviceTotal: number;
  weeklyCount: number;
  /** serviceTotal ÷ VAN_CAPACITY_PER_2WK, 1 decimal — the gauge. */
  vansEstimate: number;
  vanCapacityPer2wk: number;
  /** Most recent nightly refresh time (ISO), or null if the table is empty. */
  asOf: string | null;
}

export async function getFleetCounts(): Promise<FleetCounts> {
  await initSchema();
  const rows = (await sql`
    SELECT
      COUNT(*)::int AS customer_total,
      COUNT(*) FILTER (WHERE is_weekly)::int AS weekly_count,
      COALESCE(SUM(CASE WHEN is_weekly THEN 2 ELSE 1 END), 0)::int AS service_total,
      MAX(last_checked_at) AS as_of
    FROM mosquito_service_status
  `) as Array<{
    customer_total: number;
    weekly_count: number;
    service_total: number;
    as_of: string | Date | null;
  }>;
  const r = rows[0];
  const serviceTotal = Number(r?.service_total ?? 0);
  const asOf = r?.as_of == null ? null : r.as_of instanceof Date ? r.as_of.toISOString() : String(r.as_of);
  return {
    customerTotal: Number(r?.customer_total ?? 0),
    serviceTotal,
    weeklyCount: Number(r?.weekly_count ?? 0),
    vansEstimate: Math.round((serviceTotal / VAN_CAPACITY_PER_2WK) * 10) / 10,
    vanCapacityPer2wk: VAN_CAPACITY_PER_2WK,
    asOf,
  };
}
