/**
 * Parser for the two bulk ground-truth job exports (rev 18).
 *
 * Both files ship with `\r\r` line endings (not \r\n), so splitting must be
 * tolerant of every variant. Fields can be quoted with embedded commas.
 *
 * These are one-off-per-year operator exports, not a live feed — see
 * REFERENCE §5.9 for how to produce them again next season.
 */

/** Split on \r\r (what these exports actually use), \r\n, \n or \r. */
export function splitCsvLines(raw: string): string[] {
  return raw.split(/\r\r|\r\n|\n|\r/).filter((l) => l.trim().length > 0);
}

/** Parse one CSV row, honouring quoted fields and "" escapes. */
export function parseCsvRow(line: string): string[] {
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

/** Header-name → index lookup for a parsed header row. */
export function columnIndex(header: string[]): (name: string) => number {
  const map = new Map<string, number>();
  header.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return (name: string) => map.get(name.trim().toLowerCase()) ?? -1;
}

/**
 * Parse the date formats these exports use into an ISO "YYYY-MM-DD":
 *   Pocomos   "4/18/25"                  (M/D/YY — 2-digit year)
 *   RealGreen "4/18/2024 12:00:00 AM"    (M/D/YYYY + time)
 * Returns null on anything unparseable.
 */
export function parseExportDate(raw: string): string | null {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (m[3].length === 2) yy += yy < 70 ? 2000 : 1900; // "25" → 2025
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Normalised join keys. */
export const normEmail = (s: unknown): string => String(s || "").trim().toLowerCase();
export const normPhone = (s: unknown): string =>
  String(s || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
export const normName = (s: unknown): string =>
  String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export const normZip = (s: unknown): string => String(s || "").trim().slice(0, 5);
