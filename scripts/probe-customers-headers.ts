/**
 * READ-ONLY: map the positional columns of /customers/data to their UI header
 * labels, and sample a few real (non-test) rows to see what dates land in
 * columns 7/8/9. No mutation.
 */
import { getSessionedHtml, postSessioned } from "../src/lib/pocomos/webSession";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

(async () => {
  const html = await getSessionedHtml("/customers/");
  console.log(`/customers HTML: ${html.length} bytes`);

  // Pull <thead> th labels (the customers table header row).
  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  if (theadMatch) {
    const ths = Array.from(theadMatch[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((m, i) => `${i}: "${stripTags(m[1])}"`);
    console.log("THEAD columns:\n  " + ths.join("\n  "));
  } else {
    // Fallback: any <th> in the page
    const ths = Array.from(html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((m, i) => `${i}: "${stripTags(m[1])}"`);
    console.log("no <thead>; all <th>:\n  " + ths.slice(0, 20).join("\n  "));
  }

  // Any column header text mentioning service/date
  const serviceHeaders = Array.from(html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi))
    .map((m) => stripTags(m[1]))
    .filter((t) => /service|date|last|next/i.test(t));
  console.log("\nheaders mentioning service/date/last/next:", JSON.stringify(serviceHeaders));

  // Now grab a page and print columns 7/8/9 for the first 8 NON-test rows.
  const columns = [
    "name", "first", "last", "phone", "email", "zip", "status", "c7", "c8", "c9",
  ];
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(columns.length));
  body.set("sColumns", ",".repeat(columns.length - 1));
  body.set("iDisplayStart", "0");
  body.set("iDisplayLength", "50");
  for (let i = 0; i < columns.length; i++) {
    body.set(`mDataProp_${i}`, columns[i]);
    body.set(`bSortable_${i}`, "true");
  }
  body.set("iSortingCols", "0");
  const resp = await postSessioned<Record<string, unknown>>("/customers/data", body, { referer: "/customers/" });
  const rows = ((resp.aaData as Record<string, unknown>[]) || []).filter(
    (r) => !/test/i.test(String(r["1"]) + String(r["2"]))
  );
  console.log(`\nsample non-test rows (col1 col2 | 6:status | 7 | 8 | 9):`);
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.id}  ${r["1"]} ${r["2"]} | status=${r["6"]} | 7="${r["7"]}" | 8="${r["8"]}" | 9="${r["9"]}" | multi=${r.multiple_contracts}`
    );
  }
  console.log("\n=== done ===");
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
