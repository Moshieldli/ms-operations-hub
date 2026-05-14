/**
 * Run the full Pocomos sales provider against live data and dump the summary.
 * Run via:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-sales-provider.ts
 */
import { getSalesSummary } from "../src/lib/pocomos";

(async () => {
  console.log("Building summary (this may take a few minutes on first run)...");
  const t0 = Date.now();
  const s = await getSalesSummary({ force: true });
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  console.log("=== Totals ===");
  console.log(s.totals);

  console.log("\n=== Buckets ===");
  console.log(s.buckets);

  console.log("\n=== Retained subtypes ===");
  console.log(s.retainedSubtypes);

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
