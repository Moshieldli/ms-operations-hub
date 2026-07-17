/**
 * Verify rev 18 against the SHIPPED getSalesTaxonomy() path: both pairs now
 * export-backed, plus the reconciliation the rebuild was meant to fix (the 29
 * multi-contract + 42 zero-2025 customers from the rev-17 blind spot).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-rev18.ts
 */
import { getSalesTaxonomy } from "../src/lib/sales-taxonomy";
import { getServiceCountsData } from "../src/lib/service/serviceCounts";
import { sql } from "../src/lib/db";

(async () => {
  const [t, data] = await Promise.all([getSalesTaxonomy(), getServiceCountsData()]);
  const rr = t.returnRates;
  const box = t.returningBox;

  console.log(`export-backed years: [${[...data.exportYears].sort().join(", ")}]`);
  console.log(`scrape coverage (CY): ${rr.covered}/${rr.cohortSize} (${rr.coveragePct}%) computing=${rr.computing}\n`);

  for (const p of rr.pairs) {
    console.log(
      `${p.fromYear}→${p.toYear}: ${p.reliable ? `${p.rate.toFixed(1)}%  (${p.returned} / ${p.realFrom})` : "n/a (unreliable)"}`
    );
    if (p.reliable) {
      console.log(`    numerator paths: by tag ${p.returnedByTag} · by spray history ${p.returnedBySprayHistory}`);
      console.log(`    late-season signups counted real: ${p.fromYear}=${p.lateSignupsFrom} · ${p.toYear}=${p.lateSignupsTo}`);
    }
  }

  console.log(`\nRETURNING BOX: ${box.total}`);
  console.log(`   Auto ${box.auto} · SEB ${box.seb} · EB ${box.eb} · Renewed ${box.renewed} · spray ${box.bySprayHistory}`);
  console.log(`   prior-year real: ${box.priorYearReal} · non-active members: ${box.nonActive}`);

  // ---- counts-table composition ----
  const comp = (await sql`
    SELECT year, source, COUNT(*)::int AS customers, SUM(service_count)::int AS services
    FROM mosquito_service_counts GROUP BY year, source ORDER BY year, source
  `) as Array<{ year: number; source: string; customers: number; services: number }>;
  console.log(`\nmosquito_service_counts composition:`);
  for (const r of comp)
    console.log(`   ${r.year} [${r.source}]: ${r.customers} customers · ${r.services} services`);

  // ---- the rev-17 blind-spot cohort: did the export rescue them? ----
  const rescued = (await sql`
    SELECT COUNT(*)::int AS n FROM mosquito_service_counts
    WHERE year = 2025 AND source = 'export' AND service_count >= 2
  `) as Array<{ n: number }>;
  console.log(`\n2025 customers with >=2 export sprays: ${rescued[0]?.n ?? 0}`);

  // ---- invariants ----
  const pair = rr.pairs.find((p) => p.toYear === t.year);
  const subSum = box.auto + box.seb + box.eb + box.renewed + box.bySprayHistory;
  const checks: Array<[string, boolean]> = [
    ["box.total === CY numerator", !!pair && box.total === pair.returned],
    ["box.priorYearReal === CY denominator", !!pair && box.priorYearReal === pair.realFrom],
    ["sub-counts sum to box.total", subSum === box.total],
    ["both pairs reliable (24→25 unblocked)", rr.pairs.every((p) => p.reliable)],
    ["completed-season pair uses NO tag path", (rr.pairs.find((p) => p.toYear === String(Number(t.year) - 1))?.returnedByTag ?? -1) === 0],
  ];
  console.log("");
  let ok = true;
  for (const [n, p] of checks) {
    console.log(`${p ? "PASS" : "FAIL"}  ${n}`);
    if (!p) ok = false;
  }
  console.log(ok ? "\nALL INVARIANTS HOLD" : "\nINVARIANT VIOLATION");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
