/**
 * Verify rev 17 LIVE: polls the production /api/sales/taxonomy until the new
 * `returningBox` shape appears (i.e. the deploy has rolled), then asserts the
 * unification invariants against the live JSON. READ-ONLY.
 *
 * Run:
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-live-rev17.ts
 */
const URL_ = "https://ms-operations-hub.vercel.app/api/sales/taxonomy";
const DEADLINE_MS = 240_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const t0 = Date.now();
  let body: any = null;
  while (Date.now() - t0 < DEADLINE_MS) {
    const res = await fetch(URL_, { cache: "no-store" });
    const json: any = await res.json().catch(() => null);
    const j = json?.taxonomy ?? json;
    if (j?.returningBox) {
      body = j;
      break;
    }
    console.log(`waiting for deploy… (returningBox absent, ${Math.round((Date.now() - t0) / 1000)}s)`);
    await sleep(15_000);
  }
  if (!body) {
    console.error("TIMED OUT waiting for the rev-17 shape to go live.");
    process.exit(1);
  }

  const box = body.returningBox;
  const pair = body.returnRates.pairs.find((p: any) => p.toYear === body.year);
  console.log(`\nLIVE ${URL_}`);
  console.log(`year ${body.year} · coverage ${body.returnRates.coveragePct}%`);
  console.log(`${pair.fromYear}→${pair.toYear}: ${pair.rate.toFixed(1)}% (${pair.returned}/${pair.realFrom})`);
  console.log(`   by tag ${pair.returnedByTag} · by spray history ${pair.returnedBySprayHistory}`);
  console.log(`   late signups: ${pair.fromYear}=${pair.lateSignupsFrom} · ${pair.toYear}=${pair.lateSignupsTo}`);
  console.log(`RETURNING BOX ${box.total}`);
  console.log(
    `   Auto ${box.auto} · SEB ${box.seb} · EB ${box.eb} · Renewed ${box.renewed} · spray ${box.bySprayHistory} · nonActive ${box.nonActive}`
  );

  const subSum = box.auto + box.seb + box.eb + box.renewed + box.bySprayHistory;
  const checks: Array<[string, boolean]> = [
    ["box.total === numerator", box.total === pair.returned],
    ["box.priorYearReal === denominator", box.priorYearReal === pair.realFrom],
    ["sub-counts sum to box.total", subSum === box.total],
  ];
  console.log("");
  let ok = true;
  for (const [n, p] of checks) {
    console.log(`${p ? "PASS" : "FAIL"}  ${n}`);
    if (!p) ok = false;
  }
  console.log(ok ? "\nLIVE VERIFIED (rev 17)" : "\nLIVE INVARIANT VIOLATION");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("LIVE VERIFY FAILED:", e);
  process.exit(1);
});
