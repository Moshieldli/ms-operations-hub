/**
 * Run the mosquito service-status refresh against the real Neon DB + Pocomos
 * (READ-ONLY scrape). Validates the scrape → upsert → read pipeline end to end.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-mosquito-refresh.ts [maxCustomers]
 */
import { refreshMosquitoStatus, getOverdueReport } from "../src/lib/service/refresh";

(async () => {
  const cap = process.argv[2] ? parseInt(process.argv[2], 10) : 5000;
  console.log(`Running refresh (maxCustomers=${cap})…`);
  const meta = await refreshMosquitoStatus({ maxCustomers: cap, budgetMs: 280_000, forceDataset: false });
  console.log("REFRESH META:", JSON.stringify(meta, null, 2));

  const report = await getOverdueReport();
  console.log("\nREPORT COUNTS:", JSON.stringify(report.counts));
  console.log("lastRefreshedAt:", report.lastRefreshedAt);
  console.log("\nTop overdue (up to 10):");
  for (const r of report.overdue.slice(0, 10)) {
    console.log(`  ${r.full_name} — last=${r.last_regular_spray ?? "none"} days=${r.days_since ?? "—"} (${r.reason})`);
  }
  console.log(`\nNeeds manual check (up to 5): ${report.needsCheck.length}`);
  for (const r of report.needsCheck.slice(0, 5)) {
    console.log(`  ${r.full_name} — selected="${r.selected_contract_label}"`);
  }
})().catch((e) => {
  console.error("RUN FAILED:", e);
  process.exit(1);
});
