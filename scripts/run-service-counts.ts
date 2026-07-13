/**
 * Run the resumable service-count scrape to full coverage (local backfill of the
 * production Neon cache). Loops until reachedEnd. READ-ONLY against Pocomos.
 *
 * `force: true` re-scrapes the WHOLE cohort in one pass — needed after a schema
 * change (e.g. the 2026-07-13 first/last spray-date columns) so every cohort
 * member's dates get populated, not just active members refreshed today.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-service-counts.ts
 */
import { refreshServiceCounts } from "../src/lib/service/serviceCounts";

(async () => {
  for (let i = 1; i <= 8; i++) {
    const meta = await refreshServiceCounts({ budgetMs: 1_500_000, maxCustomers: 5000, force: true });
    console.log(
      `run ${i}: scraped=${meta.scrapedThisRun} tableOk=${meta.tableOk} notOk=${meta.tableNotOk} failed=${meta.failed} ` +
        `covered=${meta.covered}/${meta.cohortSize} (${meta.coveragePct}%) reachedEnd=${meta.reachedEnd} ${Math.round(meta.durationMs / 1000)}s`
    );
    if (meta.reachedEnd || meta.coveragePct >= 100) break;
  }
  process.exit(0);
})().catch((e) => { console.error("RUN FAILED:", e); process.exit(1); });
