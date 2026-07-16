/**
 * Verify the rev-17 return-rate + Returning-box unification against the SHIPPED
 * getSalesTaxonomy() path (not a re-implementation). Prints both cards' numbers
 * and asserts the reconciliation invariant: Returning box === the CY-1 → CY
 * numerator. READ-ONLY (Neon cache + the cached dataset).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-return-unification.ts
 */
import { getSalesTaxonomy } from "../src/lib/sales-taxonomy";

(async () => {
  const t = await getSalesTaxonomy();
  const rr = t.returnRates;
  const box = t.returningBox;

  console.log(`coverage: ${rr.covered}/${rr.cohortSize} (${rr.coveragePct}%) · computing=${rr.computing}`);
  console.log(`late-season cutoff: ${rr.lateSeasonCutoff}\n`);

  for (const p of rr.pairs) {
    if (!p.reliable) {
      console.log(`${p.fromYear}→${p.toYear}: n/a (unreliable — from-year outside history window)`);
      continue;
    }
    console.log(
      `${p.fromYear}→${p.toYear}: ${p.rate.toFixed(1)}%  (${p.returned} / ${p.realFrom})`
    );
    console.log(
      `   numerator paths: by tag ${p.returnedByTag} · by spray history ${p.returnedBySprayHistory}`
    );
    console.log(
      `   late-season signups counted real: ${p.fromYear}=${p.lateSignupsFrom} · ${p.toYear}=${p.lateSignupsTo}`
    );
  }

  console.log(`\nRETURNING BOX: ${box.total}`);
  console.log(
    `   Auto ${box.auto} · SEB ${box.seb} · EB ${box.eb} · Renewed ${box.renewed} · by spray history ${box.bySprayHistory}`
  );
  console.log(`   sub-count sum: ${box.auto + box.seb + box.eb + box.renewed + box.bySprayHistory}`);
  console.log(`   prior-year real (denominator): ${box.priorYearReal} · non-active members: ${box.nonActive}`);

  // ---- invariants ----
  const pair = rr.pairs.find((p) => p.toYear === t.year);
  const subSum = box.auto + box.seb + box.eb + box.renewed + box.bySprayHistory;
  const checks: Array<[string, boolean]> = [
    ["box.total === numerator", !!pair && box.total === pair.returned],
    ["box.priorYearReal === denominator", !!pair && box.priorYearReal === pair.realFrom],
    ["sub-counts sum to box.total", subSum === box.total],
    ["box rate === card rate", !!pair && Math.abs((box.total / box.priorYearReal) * 100 - pair.rate) < 1e-9],
  ];
  console.log("");
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\nALL INVARIANTS HOLD" : "\nINVARIANT VIOLATION");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
