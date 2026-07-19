/**
 * CSV read/write for one-off scripts (extracted from ~5 scripts that each
 * re-implemented escaping). Output CSVs are gitignored (`*.csv`).
 */
import { writeFileSync, readFileSync } from "node:fs";

const escapeCell = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * Write rows to a CSV. `rows` are objects keyed by the header names.
 * @returns the number of data rows written.
 */
export function writeCsv(
  path: string,
  headers: string[],
  rows: Array<Record<string, unknown>>
): number {
  const lines = [headers.map(escapeCell).join(",")];
  for (const r of rows) lines.push(headers.map((h) => escapeCell(r[h])).join(","));
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return rows.length;
}

/**
 * Parse a CSV whose lines may use \r\r (the Pocomos/RealGreen export quirk),
 * \r\n, \n or \r. Returns { headers, rows } with rows as objects.
 */
export function readCsv(path: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r\r|\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseRow(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });
  return { headers, rows };
}

/** Parse one CSV row, honouring quoted fields and "" escapes. */
export function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
