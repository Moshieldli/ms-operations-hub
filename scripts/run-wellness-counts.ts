/**
 * Wellness rollout step 2 — initial spray-counter fill + spot-check.
 *
 * 1. refreshResprays()      — reload respray_jobs for CURRENT_YEAR (now also
 *                             storing the report's street address).
 * 2. updateSprayCounts(true) — aggregate per-customer completed-mosquito-service
 *                             counts into mosquito_service_status.sprays_this_season.
 * 3. Spot-check: print 5 sample customers (id, name, count) AND cross-validate
 *    each against the per-customer service-history scrape (Surface C, READ-ONLY)
 *    where the rendered table is the mosquito contract.
 *
 * READ-ONLY against Pocomos. Writes only to Neon.
 *
 * Run:  node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-wellness-counts.ts
 */
import { sql } from "../src/lib/db";
import { refreshResprays } from "../src/lib/service/resprays";
import { updateSprayCounts } from "../src/lib/service/refresh";
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import {
  parseServiceHistory,
  countCompletedByYear,
  looksLikeLoginPage,
} from "../src/lib/service/serviceHistory";
import { renderedTableIsMosquito } from "../src/lib/service/mosquito";
import { CURRENT_YEAR } from "../src/lib/pocomos/categorize";

(async () => {
  console.log("---- 1. refreshResprays (completed-jobs reload, with address) ----");
  const meta = await refreshResprays();
  console.log(`  rows parsed ${meta.rowsParsed}, mosquito jobs stored ${meta.mosquitoJobsStored}, ${meta.durationMs}ms`);

  console.log("\n---- 2. updateSprayCounts ----");
  const counts = await updateSprayCounts(true);
  console.log(`  rows updated: ${counts.updated}, customers at 2+ sprays: ${counts.twoPlus}`);

  const dist = (await sql`
    SELECT sprays_this_season AS n, COUNT(*)::int AS customers
    FROM mosquito_service_status GROUP BY 1 ORDER BY 1
  `) as Array<{ n: number; customers: number }>;
  console.log("  distribution: " + dist.map((d) => `${d.n}×${d.customers}`).join("  "));

  console.log("\n---- 3. spot-check: 5 samples vs the service-history scrape ----");
  const samples = (await sql`
    SELECT pocomos_id, full_name, sprays_this_season
    FROM mosquito_service_status
    WHERE sprays_this_season >= 2
    ORDER BY md5(pocomos_id)   -- stable pseudo-random pick
    LIMIT 5
  `) as Array<{ pocomos_id: string; full_name: string; sprays_this_season: number }>;

  const year = Number(CURRENT_YEAR);
  for (const s of samples) {
    let check = "scrape n/a";
    try {
      const html = await getSessionedHtml(`/customer/${s.pocomos_id}/service-history`);
      if (looksLikeLoginPage(html)) throw new Error("login page");
      const parsed = parseServiceHistory(html);
      if (!renderedTableIsMosquito(parsed.tableContractLabel, parsed.selectedContractLabel)) {
        check = `rendered contract not mosquito ("${parsed.tableContractLabel}") — scrape can't see the mosquito table (why the bulk source wins)`;
      } else {
        const n = countCompletedByYear(parsed.rows, [year])[year];
        check = n === s.sprays_this_season ? `scrape says ${n} ✓ MATCH` : `scrape says ${n} ✗ MISMATCH`;
      }
    } catch (e) {
      check = `scrape error: ${(e as Error).message}`;
    }
    console.log(`  ${s.pocomos_id}  ${String(s.sprays_this_season).padStart(2)} sprays  ${s.full_name}`);
    console.log(`      profile: https://mypocomos.net/customer/${s.pocomos_id}/service-information`);
    console.log(`      cross-check: ${check}`);
  }

  console.log("\nDONE");
})();
