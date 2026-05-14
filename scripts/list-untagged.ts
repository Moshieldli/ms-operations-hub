/**
 * List every customer in the Tags sheet that has no year tag of the form
 * `20YY - <something>`. These are the customers who need a year tag in
 * Pocomos so the dashboard can categorize them.
 *
 * Run:
 *   ./node_modules/.bin/tsx scripts/list-untagged.ts
 */
import { fetchTagsCsv, parseTagsCsv } from "../src/lib/sheets";

const SHEET_ID = "1RGPeS5Mir2p3flA9oDOfaxyfC8xfoXyZnoe1kKCL11s";
const TAB = "Tags";
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;

(async () => {
  const csv = await fetchTagsCsv(URL);
  const parsed = parseTagsCsv(csv);

  const untagged: Array<{ id: string; rows: number; raw: string }> = [];
  for (const [id, rec] of parsed.customers) {
    if (rec.yearTags.size === 0) {
      const raw = rec.rawTagsCells
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 200);
      untagged.push({ id, rows: rec.rowCount, raw });
    }
  }

  untagged.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  console.log(`Untagged customers: ${untagged.length}`);
  console.log(`(of ${parsed.customers.size} active customers in sheet)\n`);

  console.log("Customer ID  Rows  Existing tags");
  console.log("-----------  ----  -------------");
  for (const u of untagged) {
    const rowStr = String(u.rows).padStart(2, " ");
    console.log(`${u.id.padEnd(11, " ")}  ${rowStr}    ${u.raw || "(none)"}`);
  }
})();
