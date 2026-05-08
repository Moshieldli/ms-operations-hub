/**
 * Probe the real Tags sheet via gviz CSV. If link sharing is on, this
 * just works. If not, the response will be HTML (login wall) and we surface
 * a clear error.
 */
import { fetchTagsCsv, parseTagsCsv, categorizeFromSheet, debugReport } from "../src/lib/sheets";

const SHEET_ID = "1RGPeS5Mir2p3flA9oDOfaxyfC8xfoXyZnoe1kKCL11s";
const TAB = "Tags";
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;

(async () => {
  console.log("Fetching:", URL);
  let csv: string;
  try {
    csv = await fetchTagsCsv(URL);
  } catch (e) {
    console.log("FETCH FAILED:", (e as Error).message);
    process.exit(1);
  }
  console.log(`Got ${csv.length} bytes`);
  console.log("First 300 chars:");
  console.log(csv.slice(0, 300));
  console.log("---");

  const parsed = parseTagsCsv(csv);
  console.log("Parse result:");
  console.log("  totalRows:", parsed.totalRows);
  console.log("  junkRowsSkipped:", parsed.junkRowsSkipped);
  console.log("  activeServiceRows:", parsed.activeServiceRows);
  console.log("  unique customers:", parsed.customers.size);

  const summary = categorizeFromSheet(parsed, { sheetId: SHEET_ID, tab: TAB });
  console.log("\nCategorization:");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\nDebug:");
  console.log(debugReport(parsed, summary));
})();
