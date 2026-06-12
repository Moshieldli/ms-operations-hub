/**
 * READ-ONLY: locate the live /customers/data column indices for "Sign Up Date"
 * and "Balance" so they can be added to the bulk parse in customersData.ts.
 * Dumps the full <thead> and a wide sample row (request 16 columns). No mutation.
 */
import { getSessionedHtml, postSessioned } from "../src/lib/pocomos/webSession";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

(async () => {
  const html = await getSessionedHtml("/customers/");
  console.log(`/customers HTML: ${html.length} bytes`);

  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  if (theadMatch) {
    const ths = Array.from(theadMatch[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map(
      (m, i) => `  ${i}: "${stripTags(m[1])}"`
    );
    console.log("THEAD columns:\n" + ths.join("\n"));
  } else {
    console.log("no <thead> found");
  }

  const COLS = 16;
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(COLS));
  body.set("sColumns", ",".repeat(COLS - 1));
  body.set("iDisplayStart", "0");
  body.set("iDisplayLength", "50");
  for (let i = 0; i < COLS; i++) {
    body.set(`mDataProp_${i}`, String(i));
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortingCols", "0");
  const resp = await postSessioned<Record<string, unknown>>("/customers/data", body, {
    referer: "/customers/",
  });
  const rows = ((resp.aaData as Record<string, unknown>[]) || []).filter(
    (r) => !/test/i.test(String(r["1"]) + String(r["2"]))
  );
  console.log(`\niTotalRecords=${(resp as Record<string, unknown>).iTotalRecords}`);
  console.log(`\nsample non-test rows — every column 0..${COLS - 1}:`);
  for (const r of rows.slice(0, 6)) {
    const cells: string[] = [];
    for (let i = 0; i < COLS; i++) cells.push(`${i}="${stripTags(String(r[String(i)] ?? ""))}"`);
    console.log(`  id=${r.id} multi=${r.multiple_contracts}\n    ${cells.join("  ")}`);
  }
  console.log("\n=== done ===");
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
