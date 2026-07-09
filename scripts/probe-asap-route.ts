/**
 * READ-ONLY probe: how does an ASAP-route assignment appear on the
 * /customer/{id}/scheduled-services page (#scheduled-table, "Route Assigned")?
 * Pulls a sample of currently-overdue customers and dumps the scheduled table.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-asap-route.ts
 */
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { looksLikeLoginPage } from "../src/lib/service/serviceHistory";
import { sql } from "../src/lib/db";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
function extractTableInner(html: string, tableId: string): string | null {
  const re = new RegExp(`<table\\b[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)<\\/table>`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

(async () => {
  const rows = (await sql`
    SELECT pocomos_id, full_name FROM mosquito_service_status
    WHERE status = 'overdue' ORDER BY days_since DESC NULLS FIRST LIMIT 12
  `) as Array<{ pocomos_id: string; full_name: string }>;
  console.log(`probing ${rows.length} overdue customers\n`);

  let anyAsap = 0;
  for (const r of rows) {
    const id = String(r.pocomos_id);
    let html: string;
    try {
      html = await getSessionedHtml(`/customer/${id}/scheduled-services`);
    } catch (e) {
      console.log(`  ${id} ${r.full_name}: FETCH ERROR ${(e as Error).message}`);
      continue;
    }
    if (looksLikeLoginPage(html)) {
      console.log(`  ${id}: login page`);
      continue;
    }
    const hasAsapAnywhere = /asap/i.test(html);
    const inner = extractTableInner(html, "scheduled-table");
    console.log(`===== ${id} ${r.full_name} =====  (ASAP substring in page: ${hasAsapAnywhere})`);
    if (!inner) {
      // maybe a different table id — list all table ids on the page
      const ids = Array.from(html.matchAll(/<table\b[^>]*id="([^"]+)"/gi)).map((m) => m[1]);
      console.log(`  no #scheduled-table. table ids on page: ${JSON.stringify(ids)}`);
      // dump any ASAP context
      if (hasAsapAnywhere) {
        const idx = html.search(/asap/i);
        console.log(`  ASAP context: …${stripTags(html.slice(Math.max(0, idx - 200), idx + 200))}…`);
      }
      continue;
    }
    // Header row
    const thead = inner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
    if (thead) {
      const headers = Array.from(thead[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
      console.log(`  headers: ${JSON.stringify(headers)}`);
    }
    const body = (inner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i) || [, inner])[1];
    const trs = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
    let n = 0;
    for (const tr of trs) {
      const cells = Array.from(tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => stripTags(c[1]));
      if (!cells.length) continue;
      if (++n > 4) { console.log(`  …(${trs.length} rows total)`); break; }
      console.log(`  row: ${JSON.stringify(cells)}`);
      if (cells.some((c) => /asap/i.test(c))) anyAsap++;
    }
  }
  console.log(`\nrows with an ASAP cell: ${anyAsap}`);
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
