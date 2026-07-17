/**
 * Load the two bulk ground-truth job exports into Neon and rebuild the
 * export-backed mosquito counts (2024 RealGreen, 2025 Pocomos). See REFERENCE
 * §5.9 for how to produce these files each season.
 *
 * Idempotent: truncates + reloads its own tables and the id map, and replaces
 * only source='export' count rows. The nightly CY scrape is untouched.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/load-exports.ts
 */
import { readFileSync } from "node:fs";
import { loadExportsAndRebuildCounts, REALGREEN_MOSQUITO_CODES } from "../src/lib/service/exportLoad";

(async () => {
  const t0 = Date.now();
  const res = await loadExportsAndRebuildCounts({
    jobs2025: readFileSync("data/completed_jobs_2025.csv", "utf8"),
    jobs2024: readFileSync("data/realgreen_jobs_2024.csv", "utf8"),
  });

  for (const r of res.reports) {
    console.log(`\n=== ${r.file} ===`);
    console.log(`  rows parsed/loaded : ${r.rowsParsed} / ${r.rowsLoaded}`);
    console.log(`  bad date / bad id  : ${r.badDate} / ${r.badId}`);
    console.log(`  mosquito jobs      : ${r.mosquitoJobs}  ·  non-mosquito: ${r.nonMosquitoJobs}`);
    console.log(`  distinct customers : ${r.distinctCustomers}  ·  with mosquito jobs: ${r.mosquitoCustomers}`);
    console.log(`  by category:`);
    for (const [k, v] of Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      const mos =
        k in REALGREEN_MOSQUITO_CODES
          ? ` → ${REALGREEN_MOSQUITO_CODES[k]} [MOSQUITO]`
          : "";
      console.log(`     ${String(v).padStart(6)}  ${k}${mos}`);
    }
  }

  console.log(`\n=== id map (short_id → pocomos web id) ===`);
  console.log(`  api customers : ${res.idMap.apiCustomers}`);
  console.log(`  mapped        : ${res.idMap.total}`);
  console.log(`  unresolved    : ${res.idMap.unresolved}`);
  for (const [m, n] of Object.entries(res.idMap.byMethod).sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(5)}  ${m}`);
  for (const u of res.unresolvedSample) console.log(`     unresolved: ${u.shortId} — ${u.reason}`);

  console.log(`\n=== counts rebuilt (source='export') ===`);
  for (const c of res.counts) {
    console.log(
      `  ${c.year}: ${c.customersWithCounts} customers · ${c.jobsCounted} mosquito jobs counted · ` +
        `evicted ${c.staleScrapeRowsRemoved} stale scrape rows · ` +
        `dropped ${c.jobsDroppedUnmapped} jobs from ${c.unmappedShortIds} unmapped short ids`
    );
  }
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch((e) => {
  console.error("LOAD FAILED:", e);
  process.exit(1);
});
