/**
 * One-off-per-season loader for the pre-Pocomos RealGreen seasons (rev 33).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/load-history.ts
 *
 * Loads data/{2021,2022,2023} spray dates.csv into `realgreen_jobs_history`,
 * computes the three historical return-rate pairs (21→22, 22→23, 23→24) in
 * RealGreen short-id space, and freezes them into `return_rate_history`.
 *
 * 2024's spray dates are read from the ALREADY-LOADED `realgreen_jobs_2024`
 * table rather than re-parsing its 13 MB CSV — same data, no rewrite, no risk
 * to the table the /sales anomalies card depends on.
 *
 * It also prints two VALIDATION measurements that back the design decisions in
 * historyLoad.ts, so they're evidence and not assertions:
 *
 *   (1) ID-MAP BIAS — 23→24 computed in short-id space vs the same pair forced
 *       through `customer_id_map`. The gap is how much the rate would have been
 *       inflated by dropping customers who no longer exist in Pocomos.
 *   (2) TAG-PATH GAP — 24→25 spray-only (the historical method) vs the live
 *       metric's combined spray-or-tag rule, on the one pair where both are
 *       computable. Small gap = the 5 points are comparable.
 *
 * READ-ONLY against Pocomos (never touches it).
 */
import { readFileSync } from "node:fs";
import { sql, initSchema } from "../src/lib/db";
import {
  computeHistoryPair,
  HISTORY_YEARS,
  isRealFromDates,
  loadRealgreenHistoryYear,
  saveHistoryPairs,
  sprayDatesByShortId,
  type HistoryPair,
} from "../src/lib/service/historyLoad";
import { REALGREEN_MOSQUITO_CODES } from "../src/lib/service/exportLoad";
import { MOSQUITO_SERVICE_TYPES } from "../src/lib/service/mosquito";

const pct = (n: number) => `${n.toFixed(2)}%`;

/** 2024 mosquito spray dates by short id, straight from the loaded landing table. */
async function sprayDates2024(): Promise<Map<string, string[]>> {
  const codes = Object.keys(REALGREEN_MOSQUITO_CODES);
  const rows = (await sql`
    SELECT short_id, done_date::text AS d
    FROM realgreen_jobs_2024
    WHERE program_or_service_code = ANY(${codes}::text[])
      AND done_date >= '2024-01-01' AND done_date < '2025-01-01'
  `) as Array<{ short_id: string; d: string }>;
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.short_id, [...(m.get(r.short_id) || []), r.d]);
  return m;
}

/** 2025 mosquito spray dates by short id, from the Pocomos completed-jobs export. */
async function sprayDates2025(): Promise<Map<string, string[]>> {
  // MOSQUITO_SERVICE_TYPES is stored LOWERCASED (it's a normalized lookup set),
  // while the export landed `agreement` in its original case — compare folded.
  const types = [...MOSQUITO_SERVICE_TYPES];
  const rows = (await sql`
    SELECT short_id, completed_date::text AS d
    FROM completed_jobs_2025
    WHERE LOWER(agreement) = ANY(${types}::text[])
      AND completed_date >= '2025-01-01' AND completed_date < '2026-01-01'
  `) as Array<{ short_id: string; d: string }>;
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.short_id, [...(m.get(r.short_id) || []), r.d]);
  return m;
}

/** Re-key a short-id spray map into pocomos-id space via customer_id_map. */
async function throughIdMap(src: Map<string, string[]>): Promise<Map<string, string[]>> {
  const rows = (await sql`SELECT short_id, pocomos_id FROM customer_id_map`) as Array<{
    short_id: string;
    pocomos_id: string;
  }>;
  const map = new Map(rows.map((r) => [r.short_id, r.pocomos_id]));
  const out = new Map<string, string[]>();
  for (const [shortId, dates] of src) {
    const web = map.get(shortId);
    if (!web) continue; // exactly the drop we're measuring
    out.set(web, [...(out.get(web) || []), ...dates]);
  }
  return out;
}

(async () => {
  const t0 = Date.now();
  await initSchema();

  // ---- 1. Load the three history files ----
  const sprays = new Map<number, Map<string, string[]>>();
  for (const year of HISTORY_YEARS) {
    const file = `data/${year} spray dates.csv`;
    const raw = readFileSync(file, "utf8");
    const { report, jobs } = await loadRealgreenHistoryYear(raw, year, file);
    sprays.set(year, sprayDatesByShortId(jobs, year));
    console.log(
      `\n[${year}] ${report.file}\n` +
        `  rows ${report.rowsParsed} parsed / ${report.rowsLoaded} loaded ` +
        `(${report.blankRows} blank separator rows skipped)\n` +
        `  jobs: ${report.mosquitoJobs} mosquito / ${report.nonMosquitoJobs} other · ` +
        `badDate ${report.badDate} · badId ${report.badId} · offYear ${report.offYearJobs}\n` +
        `  customers: ${report.distinctCustomers} distinct / ${report.mosquitoCustomers} mosquito\n` +
        `  top codes: ${Object.entries(report.byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([c, n]) => `${c}=${n}`)
          .join(" ")}`
    );
  }

  const y2024 = await sprayDates2024();
  console.log(`\n[2024] ${y2024.size} mosquito customers from realgreen_jobs_2024 (already loaded)`);

  // ---- 2. The three historical pairs, in short-id space ----
  const pairs: HistoryPair[] = [
    computeHistoryPair(sprays.get(2021)!, sprays.get(2022)!, 2021, 2022),
    computeHistoryPair(sprays.get(2022)!, sprays.get(2023)!, 2022, 2023),
    computeHistoryPair(sprays.get(2023)!, y2024, 2023, 2024),
  ];
  await saveHistoryPairs(pairs);

  console.log("\n=== FROZEN HISTORICAL PAIRS (short-id space, spray-only) ===");
  for (const p of pairs) {
    console.log(
      `  ${p.fromYear}→${p.toYear}: ${pct(p.rate)}  (${p.returned}/${p.realFrom}` +
        `, ${p.lateSignupsFrom} late signups)`
    );
  }

  // ---- 3. VALIDATION (1): how much bias did skipping the id map avoid? ----
  const m23 = await throughIdMap(sprays.get(2023)!);
  const m24 = await throughIdMap(y2024);
  const mapped = computeHistoryPair(m23, m24, 2023, 2024);
  const direct = pairs[2];
  console.log("\n=== VALIDATION 1 — id-map bias on 23→24 ===");
  console.log(`  short-id space : ${pct(direct.rate)} (${direct.returned}/${direct.realFrom})`);
  console.log(`  via id map     : ${pct(mapped.rate)} (${mapped.returned}/${mapped.realFrom})`);
  console.log(
    `  → id map drops ${direct.realFrom - mapped.realFrom} of ${direct.realFrom} denominator ` +
      `customers and moves the rate by ${(mapped.rate - direct.rate).toFixed(2)}pp`
  );

  // ---- 4. VALIDATION (2): spray-only vs the live combined rule, on 24→25 ----
  const y2025 = await sprayDates2025();
  const sprayOnly2425 = computeHistoryPair(y2024, y2025, 2024, 2025);
  console.log("\n=== VALIDATION 2 — 24→25 spray-only (history method) vs live ===");
  console.log(
    `  spray-only (short-id): ${pct(sprayOnly2425.rate)} ` +
      `(${sprayOnly2425.returned}/${sprayOnly2425.realFrom})`
  );
  console.log(
    `  live /sales pair uses spray-OR-active-{Y}-tag in pocomos space — compare on the page.\n` +
      `  A small gap means the 5 points are methodologically comparable.`
  );

  // ---- 5. Sanity: denominators should move smoothly, not cliff ----
  console.log("\n=== DENOMINATOR TRAJECTORY (real customers per season) ===");
  for (const y of [2021, 2022, 2023]) {
    const n = [...sprays.get(y)!.values()].filter((d) => isRealFromDates(d)).length;
    console.log(`  ${y}: ${n}`);
  }
  console.log(`  2024: ${[...y2024.values()].filter((d) => isRealFromDates(d)).length}`);
  console.log(`  2025: ${[...y2025.values()].filter((d) => isRealFromDates(d)).length}`);

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch((e) => {
  console.error("load-history failed:", e);
  process.exit(1);
});
