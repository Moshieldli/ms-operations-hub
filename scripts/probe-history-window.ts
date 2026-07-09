/**
 * READ-ONLY probe: is the service-history #services-table truncated (why 2024
 * counts collapse)? Dump total row count, min/max dates, any DataTables
 * "Showing X of Z" / pagination markers, and try the history-download link.
 */
import { getSessionedHtml, pocomosWebBase } from "../src/lib/pocomos/webSession";
import { getPocomosSession } from "../src/lib/pocomos/webSession";
import { parseServiceHistory } from "../src/lib/service/serviceHistory";

const IDS = ["1163373", "1164323", "1164025"]; // long-tenured mosquito customers

(async () => {
  for (const id of IDS) {
    const html = await getSessionedHtml(`/customer/${id}/service-history`);
    const parsed = parseServiceHistory(html);
    const dates = parsed.rows.map((r) => r.date).filter(Boolean).sort();
    console.log(`\n===== ${id} =====  rows=${parsed.rows.length} contract=${JSON.stringify(parsed.tableContractLabel)}`);
    console.log(`  date range: ${dates[0]} … ${dates[dates.length - 1]}`);
    // DataTables info text
    const info = html.match(/Showing[^<]*entries/i);
    console.log(`  info text: ${info ? info[0] : "(none)"}`);
    // length menu / page-length hints
    const lenSel = html.match(/data-length="(\d+)"|iDisplayLength["']?\s*[:=]\s*(\d+)|pageLength["']?\s*[:=]\s*(\d+)/i);
    console.log(`  page-length hint: ${lenSel ? lenSel[0] : "(none)"}`);
    // download link
    const dl = html.match(/contract\/(\d+)\/history\/download/i);
    console.log(`  history download contract id: ${dl ? dl[1] : "(none)"}`);
    // is it server-side ajax? look for a data source url
    const ajax = html.match(/service-history\/data|history\/data|"ajax"\s*:\s*"([^"]+)"|sAjaxSource["']?\s*[:=]\s*["']([^"']+)/i);
    console.log(`  ajax source: ${ajax ? ajax[0].slice(0, 120) : "(none)"}`);
  }

  // Try the download endpoint for the first id's contract.
  const html0 = await getSessionedHtml(`/customer/${IDS[0]}/service-history`);
  const dl = html0.match(/contract\/(\d+)\/history\/download/i);
  if (dl) {
    const cid = dl[1];
    const path = `/customer/${IDS[0]}/contract/${cid}/history/download`;
    const cookie = await getPocomosSession();
    const resp = await fetch(`${pocomosWebBase()}${path}`, {
      headers: { Cookie: cookie, "User-Agent": "ms-operations-hub-sync/1.0" },
      redirect: "manual",
    });
    const ct = resp.headers.get("content-type") || "";
    const body = await resp.text();
    console.log(`\n===== DOWNLOAD ${path} =====`);
    console.log(`  status=${resp.status} content-type=${ct} bytes=${body.length}`);
    // count year occurrences in the payload
    for (const y of ["2023", "2024", "2025", "2026"]) {
      const n = (body.match(new RegExp(`[/-]${y}\\b|\\b${y}[/-]`, "g")) || []).length;
      console.log(`  '${y}' date-ish occurrences: ${n}`);
    }
    console.log(`  head: ${body.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
