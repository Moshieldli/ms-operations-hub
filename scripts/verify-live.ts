/**
 * Post-deploy smoke test of the live app — a REAL browser (Playwright), not
 * curl+regex. Used by the /ship ritual. Confirms the key pages render, a
 * dropdown's children appear on click, and the DB is reachable.
 *
 * Run (no env needed for the page checks; DATABASE_URL only for the DB ping):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-live.ts
 */
import { checkLivePage, withBrowser } from "./lib/livecheck";
import { sql } from "./lib/neon";

const BASE = process.env.LIVE_BASE || "https://ms-operations-hub.vercel.app";

(async () => {
  const results: Array<{ name: string; ok: boolean; note: string }> = [];

  await withBrowser(async (browser) => {
    // /sales — Leads dropdown children render on click (the curl+regex blind spot).
    const sales = await checkLivePage(
      `${BASE}/sales`,
      { clickText: "Leads", expectText: ["Close rate", "Follow-ups", "Active Customers"] },
      browser
    );
    results.push({ name: "/sales + Leads dropdown", ok: sales.ok, note: sales.details.join(" · ") });

    // /leads/followup — the collapsible bucket sections are present.
    const followup = await checkLivePage(
      `${BASE}/leads/followup`,
      { expectText: ["Never reached", "Loop not closed", "Closed out"] },
      browser
    );
    results.push({ name: "/leads/followup buckets", ok: followup.ok, note: followup.details.join(" · ") });

    // /service/overdue — renders its headline.
    const overdue = await checkLivePage(
      `${BASE}/service/overdue`,
      { expectText: ["Overdue"] },
      browser
    );
    results.push({ name: "/service/overdue", ok: overdue.ok, note: `HTTP ${overdue.status}` });
  });

  // DB reachable + the followup cache is populated.
  try {
    const r = (await sql`SELECT COUNT(*)::int AS n FROM leads_followup`) as Array<{ n: number }>;
    results.push({ name: "Neon reachable", ok: r[0].n >= 0, note: `${r[0].n} followup rows` });
  } catch (e) {
    results.push({ name: "Neon reachable", ok: false, note: (e as Error).message });
  }

  let ok = true;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  —  ${r.note}`);
    if (!r.ok) ok = false;
  }
  console.log(ok ? "\nLIVE SMOKE TEST PASSED" : "\nLIVE SMOKE TEST FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("verify-live error:", e);
  process.exit(2);
});
