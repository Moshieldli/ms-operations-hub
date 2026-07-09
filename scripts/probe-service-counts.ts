/**
 * READ-ONLY probe: can we count COMPLETED mosquito-family services per year from
 * the service-history page? Dumps, per sampled customer, the rendered contract
 * label + a year × (type,status) tally so we can see whether Event Spray is a
 * separate contract (excluded naturally) and how "Complete" rows read.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-service-counts.ts
 */
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { parseServiceHistory, looksLikeLoginPage } from "../src/lib/service/serviceHistory";
import { sql } from "../src/lib/db";

(async () => {
  // A mix: eligible active mosquito customers + inactive customers with a 2025 tag.
  const active = (await sql`
    SELECT pocomos_id, full_name FROM mosquito_service_status
    WHERE status IN ('current','overdue') ORDER BY random() LIMIT 4
  `) as Array<{ pocomos_id: string; full_name: string }>;
  const inactive = (await sql`
    SELECT pocomos_id, full_name FROM customers
    WHERE lower(status)='inactive'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) t WHERE t LIKE '2025 -%')
    ORDER BY random() LIMIT 4
  `) as Array<{ pocomos_id: string; full_name: string }>;
  const sample = [...active.map((r) => ({ ...r, k: "active" })), ...inactive.map((r) => ({ ...r, k: "inactive" }))];

  for (const r of sample) {
    const id = String(r.pocomos_id);
    let html: string;
    try {
      html = await getSessionedHtml(`/customer/${id}/service-history`);
    } catch (e) {
      console.log(`  ${id}: FETCH ERROR ${(e as Error).message}`);
      continue;
    }
    if (looksLikeLoginPage(html)) { console.log(`  ${id}: login page`); continue; }
    const parsed = parseServiceHistory(html);
    console.log(`\n===== ${id} ${r.full_name} [${r.k}] =====`);
    console.log(`  tableContractLabel: ${JSON.stringify(parsed.tableContractLabel)}`);
    console.log(`  selectedContractLabel: ${JSON.stringify(parsed.selectedContractLabel)}`);
    // distinct types + statuses
    const types = new Map<string, number>();
    const statuses = new Map<string, number>();
    // year -> completed count (status startsWith Complete)
    const byYear = new Map<number, number>();
    const byYearType = new Map<string, number>();
    for (const row of parsed.rows) {
      types.set(row.type, (types.get(row.type) || 0) + 1);
      statuses.set(row.status, (statuses.get(row.status) || 0) + 1);
      const y = row.parsedDate ? row.parsedDate.getFullYear() : 0;
      if (/complete/i.test(row.status)) {
        byYear.set(y, (byYear.get(y) || 0) + 1);
        const key = `${y} ${row.type}`;
        byYearType.set(key, (byYearType.get(key) || 0) + 1);
      }
    }
    console.log(`  row types: ${JSON.stringify(Object.fromEntries(types))}`);
    console.log(`  row statuses: ${JSON.stringify(Object.fromEntries(statuses))}`);
    console.log(`  COMPLETED per year: ${JSON.stringify(Object.fromEntries([...byYear.entries()].sort()))}`);
    console.log(`  COMPLETED per year×type: ${JSON.stringify(Object.fromEntries([...byYearType.entries()].sort()))}`);
    // is there an Event Spray contract switcher? show contract options if present
    const opts = Array.from(html.matchAll(/data-contract(?:-id)?="(\d+)"[^>]*>([\s\S]{0,60}?)</gi)).map((m) => m[2].replace(/\s+/g, " ").trim()).filter(Boolean);
    if (opts.length) console.log(`  contract switcher options: ${JSON.stringify(opts.slice(0, 6))}`);
  }
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
