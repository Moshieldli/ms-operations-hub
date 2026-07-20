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

export interface SheetDayAssignment {
  /** ISO date. */
  date: string;
  /** tech display name → their daycode(s) that day, raw from the sheet. */
  techToDaycode: Record<string, string>;
  /** Free-text note for the day, if any (RAIN, sick, swaps). */
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
): Promise<Map<string, SheetDayAssignment> | null> {
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
 * Parse the CALENDAR grid. The grid repeats week-blocks; each week has 7 day
 * columns of 5 fields (Tech | DayCode | Van/Loc # | Towns | # Stops). A day is
 * anchored by a header cell holding its date; the ~6 rows beneath carry a tech
 * name in the Tech column and a code in the DayCode column.
 */
export function parseCalendar(
  rows: string[][],
  wantDates: Set<string>
): Map<string, SheetDayAssignment> {
  const out = new Map<string, SheetDayAssignment>();
  // Find the column offset of every date on each header row, then read down.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const iso = toIso(row[c] || "");
      if (!iso || !wantDates.has(iso)) continue;
      // Day fields span 5 columns starting at a boundary; find the Tech column
      // by scanning left to the nearest "Tech"/"DayCode" header on r+1.
      const techCol = c; // dates sit above the day's first column in this sheet
      const assign: Record<string, string> = {};
      let note: string | null = null;
      for (let rr = r + 1; rr < Math.min(r + 12, rows.length); rr++) {
        const dr = rows[rr] || [];
        const tech = (dr[techCol] || "").trim();
        const code = (dr[techCol + 1] || "").trim();
        if (/^notes:?/i.test(tech)) {
          const n = (dr[techCol + 1] || dr[techCol + 2] || "").trim();
          if (n) note = n;
          break;
        }
        if (!tech || /^tech\d*$/i.test(tech) || /^tech$/i.test(tech)) continue;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(tech)) break; // next date block
        if (code || /off|out|rain|sick/i.test(tech)) {
          assign[tech] = code || tech;
        }
      }
      if (Object.keys(assign).length || note) {
        out.set(iso, { date: iso, techToDaycode: assign, note });
      }
    }
  }
  return out;
}
