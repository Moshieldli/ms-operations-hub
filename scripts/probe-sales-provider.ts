/**
 * Run the full Pocomos sales provider against live data and dump the summary.
 * Run via:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-sales-provider.ts
 */
import { getSalesSummary } from "../src/lib/pocomos";

(async () => {
  console.log("Building summary (this may take ~60s on cold start)...");
  const t0 = Date.now();
  const s = await getSalesSummary({ force: true });
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  console.log("=== Totals ===");
  console.log(s.totals);

  console.log("\n=== Buckets ===");
  console.log(s.buckets);

  console.log("\n=== Retained subtypes ===");
  console.log(s.retainedSubtypes);

  console.log("\n=== Cancelled breakdown ===");
  console.log({
    total: s.cancelled.total,
    thisYear: s.cancelled.thisYear,
    lastYear: s.cancelled.lastYear,
    earlier: s.cancelled.earlier,
    unknown: s.cancelled.unknown,
  });
  const yearEntries = Object.entries(s.cancelled.byYear)
    .map(([y, n]) => [parseInt(y, 10), n] as const)
    .filter(([y]) => Number.isFinite(y))
    .sort((a, b) => b[0] - a[0]);
  console.log("byYear (desc):");
  for (const [y, n] of yearEntries) console.log(`  ${y}: ${n}`);

  console.log("\n=== Debug ===");
  console.log({
    untagged: s.debug.untagged,
    uncategorized: s.debug.uncategorized,
    contractsFetched: s.debug.contractsFetched,
    contractsFailed: s.debug.contractsFailed,
    tagsFetched: s.debug.tagsFetched,
    tagsFailed: s.debug.tagsFailed,
    fetchDurationMs: s.debug.fetchDurationMs,
  });

  if (s.debug.untaggedSampleIds.length) {
    console.log("Untagged sample customers:", s.debug.untaggedSampleIds);
  }
  if (s.debug.uncategorizedSampleIds.length) {
    console.log("Uncategorized sample customers:", s.debug.uncategorizedSampleIds);
  }
})();
