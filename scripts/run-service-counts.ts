/**
 * Run the resumable service-count scrape to full coverage (local backfill of the
 * production Neon cache). Loops until reachedEnd. READ-ONLY against Pocomos.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-service-counts.ts
 */
import { refreshServiceCounts } from "../src/lib/service/serviceCounts";

(async () => {
  for (let i = 1; i <= 8; i++) {
    const meta = await refreshServiceCounts({ budgetMs: 550_000, maxCustomers: 5000 });
    console.log(
      `run ${i}: scraped=${meta.scrapedThisRun} tableOk=${meta.tableOk} notOk=${meta.tableNotOk} failed=${meta.failed} ` +
        `covered=${meta.covered}/${meta.cohortSize} (${meta.coveragePct}%) reachedEnd=${meta.reachedEnd} ${Math.round(meta.durationMs / 1000)}s`
    );
    if (meta.reachedEnd || meta.coveragePct >= 100) break;
  }
  process.exit(0);
})().catch((e) => { console.error("RUN FAILED:", e); process.exit(1); });
