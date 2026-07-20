/**
 * Live reader for the "2026 Master Routing List" Google Sheet (rev 45) — the
 * CALENDAR tab's per-day tech assignments.
 *
 * ⚠️ DORMANT until the Google Drive + Sheets APIs are enabled for the service
 * account (the same blocker as the referral scanner — see BACKLOG). Every entry
 * point returns null when credentials are missing, so the schedule board runs
 * entirely off Pocomos + the DAYCODES snapshot (`routeTowns.ts`) until then, and
 * this OVERLAYS tech names onto the days once the sheet is readable.
 *
 * The CALENDAR is hand-edited with merged cells, week blocks, and free-text
 * notes (OFF/OUT/RAIN/"called out sick"), so the parser is intentionally
 * defensive: it locates a date header, then reads the tech rows beneath it, and
 * skips anything it can't parse rather than throwing. Built against the
 * 2026-07-20 structure probe; may need tuning against live data once enabled.
 */
import { hasDriveCredentials, readSheetValues } from "./payrollDrive";
import { CURRENT_YEAR } from "@/lib/pocomos";

const CALENDAR_TAB = "CALENDAR";

/** One tech's row for a day, verbatim from the CALENDAR (rev 49). */
export interface SheetTechRow {
  /** Tech name AS WRITTEN on the sheet — e.g. "Nick", "Joseph" (variants kept). */
  tech: string;
  /** DayCode cell — e.g. "609", "101, 501", "OFF", "ANT", "RLW". */
  daycode: string;
  /** Van / Loc # cell. */
  van: string;
  /** Towns cell, as written (region label like "Westchester"/"Local"). */
  towns: string;
  /** # Stops, or null when blank. */
  stops: number | null;
}

export interface SheetDay {
  /** ISO date. */
  date: string;
  /** Real tech assignments — placeholder "Tech1..Tech6" slots dropped. */
  rows: SheetTechRow[];
  /** The day-level "Notes:" cell (RAIN/sick/swap), if any. */
  note: string | null;
}

export function hasMasterRoutingAccess(): boolean {
  return hasDriveCredentials();
}

/** The sheet id, overridable for a different season/testing. */
export const MASTER_ROUTING_SHEET_ID =
  process.env.MASTER_ROUTING_SHEET_ID || "1EPKjgwaFEA-q_QpvBXSAyL14V-3JxPIAJaNggefCA0o";

/** "M/D/YYYY" → ISO, else null. */
function toIso(s: string): string | null {
  const m = String(s).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Per-date tech assignments from the CALENDAR, for the requested ISO dates.
 * Returns null when the sheet can't be read (no creds / API disabled / not
 * shared) — the caller then shows the Pocomos-only board.
 *
 * Uses the same read-only service-account token as the payroll scanner.
 */
export async function getMasterRoutingSchedule(
  dates: string[]
): Promise<Map<string, SheetDay> | null> {
  if (!hasDriveCredentials()) return null;
  try {
    const rows = await readSheetValues(MASTER_ROUTING_SHEET_ID, `${CALENDAR_TAB}!A1:AH400`);
    if (!rows) return null;
    void CURRENT_YEAR;
    return parseCalendar(rows, new Set(dates));
  } catch {
    return null;
  }
}

/**
 * Parse the CALENDAR grid (rev 49, built against the live 2026-07-20 layout).
 *
 * The grid repeats week blocks. In each block:
 *   - a DATE-HEADER row holds the weekday + date per day column;
 *   - the row BELOW it is the label row: "Tech | DayCode | Van/Loc # | Towns |
 *     # Stops" repeated once per day, so each day starts at a column where the
 *     label cell is exactly "Tech";
 *   - ~6 tech rows follow, then a "Notes:" row.
 *
 * Hand-edited quirks handled defensively: Saturday's block drops the Van/Loc #
 * column (so field offsets are read from the label row, not assumed), future
 * days are unfilled "Tech1..Tech6" placeholders (dropped), and OFF/OUT/RAIN sit
 * in the DayCode/Towns cells and are kept verbatim.
 */
export function parseCalendar(
  rows: string[][],
  wantDates: Set<string>
): Map<string, SheetDay> {
  const out = new Map<string, SheetDay>();
  const isTechLabel = (c: string) => c.trim().toLowerCase() === "tech";
  const isPlaceholder = (c: string) => /^tech\s*\d*$/i.test(c.trim());

  for (let r = 0; r + 1 < rows.length; r++) {
    const labels = rows[r + 1] || [];
    // Day-start columns = every column where the label row says exactly "Tech".
    const dayStarts = labels.map((c, i) => (isTechLabel(String(c || "")) ? i : -1)).filter((i) => i >= 0);
    if (dayStarts.length === 0) continue;
    const header = rows[r] || [];

    for (const dc of dayStarts) {
      // The date for this day sits in the header row within the day's columns.
      let iso: string | null = null;
      for (let k = dc; k <= dc + 4 && k < header.length; k++) {
        const d = toIso(header[k] || "");
        if (d) { iso = d; break; }
      }
      if (!iso || !wantDates.has(iso)) continue;

      // Field columns, read from the label row so Saturday's missing Van col
      // doesn't shift everything.
      const findCol = (re: RegExp, fallback: number) => {
        for (let k = dc; k <= dc + 5 && k < labels.length; k++) {
          if (re.test(String(labels[k] || "").trim())) return k;
        }
        return fallback;
      };
      const cDay = findCol(/^daycode$/i, dc + 1);
      const cVan = findCol(/van|loc/i, dc + 2);
      const cTown = findCol(/^towns$/i, dc + 3);
      const cStop = findCol(/stops/i, dc + 4);

      const techRows: SheetTechRow[] = [];
      let note: string | null = null;
      for (let rr = r + 2; rr < Math.min(r + 12, rows.length); rr++) {
        const row = rows[rr] || [];
        const tech = String(row[dc] || "").trim();
        if (/^notes:?$/i.test(tech)) {
          const n = String(row[dc + 1] || row[cDay] || "").trim();
          if (n) note = n;
          break;
        }
        if (toIso(tech)) break; // next week's date-header
        if (!tech || isPlaceholder(tech)) continue;
        const daycode = String(row[cDay] || "").trim();
        const towns = String(row[cTown] || "").trim();
        const stopsRaw = String(row[cStop] || "").trim();
        const stops = /^\d+$/.test(stopsRaw) ? Number(stopsRaw) : null;
        // Keep OFF/OUT/RAIN even when there's no daycode.
        if (!daycode && !towns && !/off|out|rain|sick|office/i.test(tech)) continue;
        techRows.push({ tech, daycode, van: String(row[cVan] || "").trim(), towns, stops });
      }
      if (techRows.length || note) out.set(iso, { date: iso, rows: techRows, note });
    }
  }
  return out;
}
