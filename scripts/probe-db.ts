/**
 * Quick DB sanity check: bootstrap schema, write a synthetic snapshot row,
 * then read it back. Uses the dev Neon branch via DATABASE_URL.
 */
import { initSchema, sql } from "../src/lib/db";
import { writeSnapshot, listSnapshots } from "../src/lib/snapshots";
import type { SalesSummary } from "../src/lib/pocomos";

(async () => {
  console.log("Bootstrapping schema...");
  await initSchema();
  console.log("Schema OK");

  const tableInfo = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('snapshots','customers')
    ORDER BY table_name
  `) as Array<{ table_name: string }>;
  console.log(
    "Tables:",
    tableInfo.map((t) => t.table_name).join(", ")
  );

  // Synthetic summary just for the round-trip.
  const synthetic: SalesSummary = {
    asOf: new Date().toISOString(),
    year: "2026",
    source: { kind: "pocomos-api", office: "1512" },
    totals: {
      activeCustomers: 1073,
      activeServices: 1347,
      cancelledCustomers: 2660,
      onHoldCustomers: 14,
    },
    buckets: { NEW: 41, RETURNING: 5, RETAINED: 900, AT_RISK: 123, CANCELLED: 2660 },
    retainedSubtypes: { auto: 450, seb: 305, eb: 145 },
    cancelled: {
      total: 2660,
      thisYear: 15,
      lastYear: 426,
      earlier: 2187,
      unknown: 32,
      byYear: { "2026": 15, "2025": 426, "2024": 452, "2023": 496, "2022": 621, "2021": 618 },
    },
    debug: {
      untagged: 0,
      uncategorized: 4,
      untaggedSampleIds: [],
      uncategorizedSampleIds: [],
      contractsFetched: 1073,
      contractsFailed: 0,
      tagsFetched: 1522,
      tagsFailed: 0,
      fetchDurationMs: 55820,
    },
  };

  const result = await writeSnapshot(synthetic, { date: "2099-01-01" });
  console.log("Write result:", result);

  const back = await listSnapshots(5);
  console.log(`Read back ${back.length} snapshot(s):`);
  for (const row of back) {
    console.log(
      `  ${row.snapshot_date} active=${row.active_count} new=${row.new_count} returning=${row.returning_count} cancelled=${row.cancelled_count}`
    );
  }

  // Cleanup: delete the synthetic row.
  await sql`DELETE FROM snapshots WHERE snapshot_date = '2099-01-01'`;
  console.log("Cleanup done");
})();
