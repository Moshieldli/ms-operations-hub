import { initSchema, sql } from "./db";
import type { SalesSummary } from "./pocomos";

export interface SnapshotRow {
  id: string;
  snapshot_date: string;
  active_count: number;
  services_count: number;
  new_count: number;
  returning_count: number;
  retained_count: number;
  retained_auto: number;
  retained_seb: number;
  retained_eb: number;
  at_risk_count: number;
  cancelled_count: number;
  cancelled_2026: number;
  cancelled_2025: number;
  cancelled_2024: number;
  cancelled_2023: number;
  cancelled_2022: number;
  cancelled_2021: number;
  on_hold_count: number;
  untagged_count: number;
  raw_json: unknown;
  captured_at: string;
}

/** ISO date in Eastern time (snapshot day = the ET calendar day the cron fires). */
function easternDateString(d = new Date()): string {
  // en-CA gives YYYY-MM-DD; America/New_York covers EST/EDT.
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * As of the 2026 redefinition, `active_count` / `services_count` store the
 * tag-gated headline numbers (Active Customer = active status + a current-year
 * tag; Active Services = that customer's active-status contracts). The raw
 * all-status counts and the grouped service-family breakdown live inside
 * `raw_json` (summary.debug.activeAllStatuses / activeServicesAllStatuses and
 * summary.contractTypeGroups, which nests the granular contract types under
 * each family) — so no schema migration is needed.
 */
export async function writeSnapshot(
  summary: SalesSummary,
  options: { date?: string } = {}
): Promise<{ snapshotDate: string; inserted: boolean }> {
  await initSchema();
  const snapshotDate = options.date || easternDateString();
  const c = summary.cancelled.byYear;

  const inserted = await sql`
    INSERT INTO snapshots (
      snapshot_date,
      active_count, services_count,
      new_count, returning_count,
      retained_count, retained_auto, retained_seb, retained_eb,
      at_risk_count,
      cancelled_count,
      cancelled_2026, cancelled_2025, cancelled_2024,
      cancelled_2023, cancelled_2022, cancelled_2021,
      on_hold_count, untagged_count,
      raw_json
    ) VALUES (
      ${snapshotDate}::date,
      ${summary.totals.activeCustomers}, ${summary.totals.activeServices},
      ${summary.buckets.NEW}, ${summary.buckets.RETURNING},
      ${summary.buckets.RETAINED}, ${summary.retainedSubtypes.auto},
        ${summary.retainedSubtypes.seb}, ${summary.retainedSubtypes.eb},
      ${summary.buckets.AT_RISK},
      ${summary.buckets.CANCELLED},
      ${c["2026"] || 0}, ${c["2025"] || 0}, ${c["2024"] || 0},
      ${c["2023"] || 0}, ${c["2022"] || 0}, ${c["2021"] || 0},
      ${summary.totals.onHoldCustomers}, ${summary.debug.untagged},
      ${JSON.stringify(summary)}::jsonb
    )
    ON CONFLICT (snapshot_date) DO UPDATE SET
      active_count = EXCLUDED.active_count,
      services_count = EXCLUDED.services_count,
      new_count = EXCLUDED.new_count,
      returning_count = EXCLUDED.returning_count,
      retained_count = EXCLUDED.retained_count,
      retained_auto = EXCLUDED.retained_auto,
      retained_seb = EXCLUDED.retained_seb,
      retained_eb = EXCLUDED.retained_eb,
      at_risk_count = EXCLUDED.at_risk_count,
      cancelled_count = EXCLUDED.cancelled_count,
      cancelled_2026 = EXCLUDED.cancelled_2026,
      cancelled_2025 = EXCLUDED.cancelled_2025,
      cancelled_2024 = EXCLUDED.cancelled_2024,
      cancelled_2023 = EXCLUDED.cancelled_2023,
      cancelled_2022 = EXCLUDED.cancelled_2022,
      cancelled_2021 = EXCLUDED.cancelled_2021,
      on_hold_count = EXCLUDED.on_hold_count,
      untagged_count = EXCLUDED.untagged_count,
      raw_json = EXCLUDED.raw_json,
      captured_at = NOW()
    RETURNING xmax = 0 AS inserted
  `;
  const row = (inserted as Array<{ inserted: boolean }>)[0];
  return { snapshotDate, inserted: row?.inserted ?? false };
}

export async function listSnapshots(limit = 30): Promise<SnapshotRow[]> {
  await initSchema();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 365));
  const rows = await sql`
    SELECT * FROM snapshots
    ORDER BY snapshot_date DESC
    LIMIT ${safeLimit}
  `;
  return rows as unknown as SnapshotRow[];
}
