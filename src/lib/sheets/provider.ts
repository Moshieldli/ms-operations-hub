import { parseCsv } from "./csv";
import type { CustomerRecord, SheetParseResult } from "./types";

const YEAR_TAG_REGEX = /^20\d\d - .+/;

/**
 * Parse the Tags sheet CSV per the V1 spec:
 *  - Column A = Customer ID (mapped to customer_number internally)
 *  - Column B = Tags (comma-separated; mixed content)
 *  - Skip rows where Customer ID is 0, blank, or non-numeric
 *  - From the Tags cell, keep only tags matching /^20\d\d - .+/ (year tags)
 *  - Group by Customer ID, union year tags across all rows for that customer
 *  - Active customer count = unique Customer IDs after junk filtering
 *  - Active services count = total non-junk rows
 */
export function parseTagsCsv(csv: string): SheetParseResult {
  const rows = parseCsv(csv);
  const customers = new Map<string, CustomerRecord>();
  let activeServiceRows = 0;
  let junkRowsSkipped = 0;
  const totalRows = Math.max(rows.length - 1, 0); // exclude header row from "total seen"

  // Find header row (first row). Tolerate header variants.
  if (!rows.length) {
    return {
      customers,
      activeServiceRows,
      totalRows: 0,
      junkRowsSkipped: 0,
    };
  }
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const idIdx = header.findIndex((h) =>
    /(customer\s*id|customer_number|customer\s*number)/i.test(h)
  );
  const tagsIdx = header.findIndex((h) => /tags?/i.test(h));
  // Default to A=0, B=1 if header detection fails (sheet has known layout).
  const idCol = idIdx >= 0 ? idIdx : 0;
  const tagsCol = tagsIdx >= 0 ? tagsIdx : 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const rawId = String(row[idCol] ?? "").trim();
    // Junk filter: blank, "0", or anything not pure digits
    if (!rawId || rawId === "0" || !/^\d+$/.test(rawId)) {
      junkRowsSkipped++;
      continue;
    }

    activeServiceRows++;
    const tagsCell = String(row[tagsCol] ?? "");
    const yearTagsThisRow = tagsCell
      .split(",")
      .map((t) => t.trim())
      .filter((t) => YEAR_TAG_REGEX.test(t));

    let rec = customers.get(rawId);
    if (!rec) {
      rec = {
        customerNumber: rawId,
        yearTags: new Set<string>(),
        rawTagsCells: [],
        rowCount: 0,
      };
      customers.set(rawId, rec);
    }
    rec.rowCount++;
    rec.rawTagsCells.push(tagsCell);
    for (const t of yearTagsThisRow) rec.yearTags.add(t);
  }

  return { customers, activeServiceRows, totalRows, junkRowsSkipped };
}

/**
 * Fetch a Google Sheets tab as CSV. The URL must point to a CSV-export
 * endpoint — either the publish-to-web URL
 * (`...spreadsheets/d/e/{publishId}/pub?gid=...&output=csv`) or the gviz
 * endpoint (`...spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv&sheet=Tags`).
 *
 * We don't authenticate here — the sheet must be readable by anyone with the
 * link, or published to web. Auth-gated fetching is a future enhancement.
 */
export async function fetchTagsCsv(url: string): Promise<string> {
  const resp = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(
      `Sheets CSV fetch failed: HTTP ${resp.status} ${resp.statusText}`
    );
  }
  const text = await resp.text();
  // gviz CSV endpoint returns plain CSV. Publish-to-web does too. If we ever
  // get HTML back (auth wall, login page), fail fast with a clear message.
  if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    throw new Error(
      "Sheets CSV fetch returned HTML — sheet is likely not public. Either publish-to-web or change link sharing to 'Anyone with the link can view'."
    );
  }
  return text;
}
