/**
 * Verify the mosquito overdue pipeline end-to-end against live data WITHOUT
 * touching the DB or mutating Pocomos:
 *   1. Build the dataset, select eligible (active + active mosquito contract).
 *   2. Confirm test customer 1163370 (Ohavia Feldman) is eligible.
 *   3. Scrape a few eligible customers' service-history (READ-ONLY GET) and
 *      print computed overdue status + selected-contract handling.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-mosquito-eligibility.ts
 */
import { getDataset } from "../src/lib/pocomos";
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { parseServiceHistory, looksLikeLoginPage } from "../src/lib/service/serviceHistory";
import {
  selectEligible,
  computeMosquitoStatus,
  renderedTableIsMosquito,
} from "../src/lib/service/mosquito";

(async () => {
  console.log("Building dataset (full fetch, ~55s)…");
  const ds = await getDataset({ force: true });
  console.log(`customers: ${ds.customers.length}, active: ${ds.diagnostics.activeCount}`);

  const eligible = selectEligible(ds.customers);
  console.log(`\nELIGIBLE (active + active mosquito contract): ${eligible.length}`);
  const byType = new Map<string, number>();
  for (const e of eligible) byType.set(e.mosquitoContractType, (byType.get(e.mosquitoContractType) || 0) + 1);
  console.log("by mosquito contract type:");
  for (const [t, n] of byType) console.log(`  ${t}: ${n}`);

  const ohavia = eligible.find((e) => e.id === "1163370");
  console.log(`\nOhavia (1163370) eligible: ${ohavia ? "YES — " + JSON.stringify(ohavia) : "NO"}`);

  // Scrape Ohavia + the first few other eligible customers.
  const sample = [
    ...(ohavia ? [ohavia] : []),
    ...eligible.filter((e) => e.id !== "1163370").slice(0, 14),
  ];
  console.log(`\nScraping ${sample.length} eligible customers (READ-ONLY):`);
  let overdue = 0, current = 0, needsCheck = 0;
  for (const e of sample) {
    try {
      const html = await getSessionedHtml(`/customer/${e.id}/service-history`);
      if (looksLikeLoginPage(html)) {
        console.log(`  [${e.id}] ${e.fullName}: LOGIN PAGE (session issue)`);
        continue;
      }
      const parsed = parseServiceHistory(html);
      const isMosq = renderedTableIsMosquito(parsed.tableContractLabel, parsed.selectedContractLabel);
      if (!isMosq) {
        needsCheck++;
        console.log(
          `  [${e.id}] ${e.fullName}: NEEDS MANUAL CHECK — table="${parsed.tableContractLabel}" (not mosquito), rows=${parsed.rows.length}`
        );
        continue;
      }
      const st = computeMosquitoStatus(parsed.rows);
      if (st.status === "overdue") overdue++; else current++;
      console.log(
        `  [${e.id}] ${e.fullName}: ${st.status} (${st.reason}) last=${st.lastRegularSpray} daysSince=${st.daysSince} rows=${parsed.rows.length} table="${parsed.tableContractLabel}"`
      );
    } catch (err) {
      console.log(`  [${e.id}] ${e.fullName}: ERROR ${(err as Error).message.slice(0, 100)}`);
    }
  }
  console.log(`\nsample tally: overdue=${overdue} current=${current} needsCheck=${needsCheck}`);
  console.log("\n=== eligibility probe done ===");
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
