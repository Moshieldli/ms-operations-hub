/**
 * PROBE (READ-ONLY) for the balance-clearance feature (rev 55).
 *
 * Answers, against live data:
 *   1. Cost of ONE Unpaid Invoices pull (token GET + report POST + parse) —
 *      sets the Collections-Mode poll interval.
 *   2. Stability: two back-to-back pulls should agree (a transiently-omitted
 *      invoice would show as a diff → false "clear").
 *   3. Current paused roster vs the fresh report: how many paused rows would
 *      read as "cleared" right now (should be ~0 outside business activity;
 *      each one is either a real overnight payment or a red flag).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-clearance-source.ts
 */
import { fetchOpenBalances } from "../src/lib/service/openBalance";
import { sql } from "../src/lib/db";

(async () => {
  const t0 = Date.now();
  const a = await fetchOpenBalances();
  const tA = Date.now() - t0;
  console.log(`pull #1: ${tA} ms — ${a.byId.size} customers, ${a.totalInvoices} invoices, $${a.totalBalance}`);

  const t1 = Date.now();
  const b = await fetchOpenBalances();
  const tB = Date.now() - t1;
  console.log(`pull #2: ${tB} ms — ${b.byId.size} customers, ${b.totalInvoices} invoices, $${b.totalBalance}`);

  // Cross-pull diff (transient-omission check).
  let missingIn2 = 0;
  let changed = 0;
  for (const [id, cb] of a.byId) {
    const nb = b.byId.get(id);
    if (!nb) {
      missingIn2++;
      console.log(`  in #1 not #2: ${id} $${cb.balance}`);
    } else if (nb.balance !== cb.balance) {
      changed++;
      console.log(`  changed: ${id} $${cb.balance} -> $${nb.balance}`);
    }
  }
  let missingIn1 = 0;
  for (const id of b.byId.keys()) if (!a.byId.has(id)) missingIn1++;
  console.log(`cross-pull: missingIn2=${missingIn2} missingIn1=${missingIn1} changed=${changed}`);

  // Paused roster vs fresh report.
  const paused = (await sql`
    SELECT pocomos_id, full_name, open_balance::float AS bal
    FROM mosquito_service_status
    WHERE status = 'paused_balance' AND open_balance > 0
    ORDER BY open_balance DESC
  `) as Array<{ pocomos_id: string; full_name: string | null; bal: number }>;
  console.log(`\npaused roster: ${paused.length} rows`);
  let wouldClear = 0;
  let partials = 0;
  for (const p of paused) {
    const nb = b.byId.get(p.pocomos_id)?.balance ?? 0;
    if (nb === 0) {
      wouldClear++;
      console.log(`  WOULD-CLEAR: ${p.full_name} (${p.pocomos_id}) stored $${p.bal} -> report $0`);
    } else if (nb < p.bal) {
      partials++;
      console.log(`  partial-drop: ${p.full_name} stored $${p.bal} -> $${nb}`);
    }
  }
  console.log(`would-clear now: ${wouldClear}, partial drops: ${partials}`);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
