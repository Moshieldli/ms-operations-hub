/**
 * Verify the 2026-07-13 return-rate rule change (>=1 completed service with a
 * late-one-off carve-out, replacing the >=2 threshold). Prints, for each year
 * pair: the OLD (>=2 both years) rate, the NEW (shipped) rate, and how many
 * single-late-spray customers the carve-out excludes per year. Also prints the
 * live Missing-tags / issues counts. READ-ONLY (reads the Neon cache only).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-return-rate-change.ts
 */
import { CURRENT_YEAR } from "../src/lib/pocomos";
import { buildServiceCountCohort, getServiceCountsData } from "../src/lib/service/serviceCounts";
import { getSalesTaxonomy } from "../src/lib/sales-taxonomy";

function isLate(iso: string): boolean {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return false;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  if (mm !== 8) return mm > 8;
  return dd > 15;
}

(async () => {
  const cy = Number(CURRENT_YEAR);
  const [cohort, data] = await Promise.all([buildServiceCountCohort(), getServiceCountsData()]);
  const ids = cohort.map((m) => m.id);

  const cnt = (id: string, y: number) =>
    data.tableOk.has(id) ? data.counts.get(id)?.[y] ?? 0 : -1; // -1 = not table_ok
  const first = (id: string, y: number) => data.firstDates.get(id)?.[y];

  const oldReal = (id: string, y: number) => cnt(id, y) >= 2;
  const newReal = (id: string, y: number) => {
    const c = cnt(id, y);
    if (c < 1) return false;
    if (c >= 2) return true;
    const f = first(id, y);
    return f ? !isLate(f) : true;
  };
  const singleLate = (id: string, y: number) => {
    if (cnt(id, y) !== 1) return false;
    const f = first(id, y);
    return f ? isLate(f) : false;
  };

  console.log(`cohort=${cohort.length} scraped=${data.scraped.size} tableOk=${data.tableOk.size}\n`);

  for (const [f, t] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
    let oldFrom = 0, oldRet = 0, newFrom = 0, newRet = 0, lateFrom = 0, lateTo = 0;
    for (const id of ids) {
      if (singleLate(id, f)) lateFrom++;
      if (singleLate(id, t)) lateTo++;
      if (oldReal(id, f)) { oldFrom++; if (oldReal(id, t)) oldRet++; }
      if (newReal(id, f)) { newFrom++; if (newReal(id, t)) newRet++; }
    }
    const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "n/a");
    console.log(`${f} → ${t}  (reliable=${f >= cy - 1})`);
    console.log(`  OLD (>=2 both):  ${pct(oldRet, oldFrom)}%  (${oldRet} / ${oldFrom})`);
    console.log(`  NEW (>=1, late one-off excl):  ${pct(newRet, newFrom)}%  (${newRet} / ${newFrom})`);
    console.log(`  single-late-spray excluded — ${f}: ${lateFrom}, ${t}: ${lateTo}\n`);
  }

  const tax = await getSalesTaxonomy();
  console.log("SHIPPED getSalesTaxonomy().returnRates.pairs:");
  for (const p of tax.returnRates.pairs) {
    console.log(
      `  ${p.fromYear}→${p.toYear} reliable=${p.reliable} rate=${p.rate.toFixed(1)}% ` +
        `(${p.returned}/${p.realFrom}) exclLate from=${p.excludedLateFrom} to=${p.excludedLateTo}`
    );
  }
  console.log(`  coverage=${tax.returnRates.coveragePct}% cutoff=${tax.returnRates.lateSeasonCutoff}`);
  console.log(
    `\nMissing tags: ${tax.missingTagsCount} (of which no-prior-tag/issues: ${tax.issuesCount})`
  );
  process.exit(0);
})().catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
