/**
 * Schedule board data (rev 50) — the `/tv/board` + `/service/board` route board.
 *
 * PRIMARY SOURCE is the "2026 Master Routing List" CALENDAR (tech-first rows,
 * like the physical board): per day, one row per tech — NAME | DayCode | Van/Loc
 * # | Towns | # Stops. POCOMOS is SECONDARY: it supplies the electric-blower
 * marker (which scheduled customers on a route carry `NT - Electric Blower Only`)
 * and a Pocomos-derived fallback for days the sheet hasn't filled yet.
 * Open-Meteo drives the weather strip + the ANT dry-day rain caution.
 *
 * DISPLAY-ONLY. No writes to Pocomos or the sheet.
 */
import { sql } from "@/lib/db";
import { getForecast, type ForecastDay } from "@/lib/weather";
import { daycodeArea, daycodeTowns, isAntDaycode, normalizeDaycode } from "./routeTowns";
import { getMasterRoutingSchedule, type SheetDay } from "./masterRouting";
import { weekStart } from "./resprays";

/** Precip probability (%) that counts as a wet day for the ant dry-day check. */
const RAIN_PROB = 55;

/** One tech's route for a day (tech-first, from the sheet). */
export interface BoardRoute {
  tech: string;
  daycode: string;
  van: string;
  /** Region/towns label — the sheet's when present, else the DAYCODES snapshot. */
  towns: string;
  stops: number | null;
  ant: boolean;
  /** Electric-blower customers scheduled on this route today (Pocomos). */
  electricBlower: number;
  /** OFF / OUT / RAIN / OFFICE DAY row — rendered as a status, not a route. */
  off: string | null;
}

export interface BoardDay {
  date: string;
  label: string;
  weekday: string;
  /** Today (Eastern) — highlighted on the weekly grid (rev 62). */
  isToday: boolean;
  /** Tech-first rows. Empty when the sheet hasn't scheduled this day yet. */
  rows: BoardRoute[];
  /** Pocomos daycode fallback (used only when `rows` is empty). */
  fallback: Array<{ daycode: string; area: string; stops: number; electricBlower: number; ant: boolean }>;
  weather: ForecastDay | null;
  note: string | null;
  /** Ant route today AND rain within the 3-day window (service day + 2). */
  antRainRisk: boolean;
  fromSheet: boolean;
}

export interface Announcements {
  thisWeek: string;
  nextWeek: string;
  /** URGENT banner ("MON MORNING MEETINGS!") — big on both boards when set. */
  urgent: string;
}

export interface ScheduleBoard {
  days: BoardDay[];
  announcements: Announcements;
  sheetConnected: boolean;
  asOf: string;
  stale: boolean;
  /** Sun–Fri SERVICE week being shown (rev 62). */
  weekStart: string;
  weekEnd: string;
  /** True when a ?week= override is being viewed (admin review, never the TV). */
  weekOverridden: boolean;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso: string) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];

function easternToday(): string {
  const eastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${eastern.getFullYear()}-${String(eastern.getMonth() + 1).padStart(2, "0")}-${String(
    eastern.getDate()
  ).padStart(2, "0")}`;
}

/**
 * The CURRENT Sun–Fri SERVICE week (rev 62) — the whole week, not a rolling
 * today-forward window, mirroring the physical board. Flips on SATURDAY (same
 * convention as the tech board: nothing lands after a week's Friday, so
 * Saturday already shows next week). ⚠️ Distinct from the Sat–Fri SALES week
 * (categorize.ts::startOfSaturdayWeek) used by the /tv/sales bell.
 */
function serviceWeek(today: string): string[] {
  let ws = weekStart(today); // Sunday of today's week (resprays.ts convention)
  if (weekdayOf(today) === "Sat") ws = addDays(ws, 7);
  return [0, 1, 2, 3, 4, 5].map((n) => addDays(ws, n)); // Sun..Fri, ALWAYS 6
}

const OFF_RE = /off|out|rain|sick|office|vac|holiday|trn|training/i;
const isOffCode = (code: string, tech: string) =>
  (!code && OFF_RE.test(tech)) || OFF_RE.test(code);

async function getAnnouncements(): Promise<Announcements> {
  const rows = (await sql`
    SELECT this_week, next_week, urgent FROM board_announcements WHERE id = 1
  `) as Array<{ this_week: string; next_week: string; urgent: string }>;
  return {
    thisWeek: rows[0]?.this_week ?? "",
    nextWeek: rows[0]?.next_week ?? "",
    urgent: rows[0]?.urgent ?? "",
  };
}

export async function getScheduleBoard(
  options: { weekOf?: string } = {}
): Promise<ScheduleBoard> {
  const today = easternToday();
  // ?week= override (admin review on /service/board only — the TV never passes it).
  const weekOverridden = Boolean(options.weekOf && /^\d{4}-\d{2}-\d{2}$/.test(options.weekOf));
  const window = weekOverridden
    ? [0, 1, 2, 3, 4, 5].map((n) => addDays(weekStart(options.weekOf!), n))
    : serviceWeek(today);
  const first = window[0];
  const last = window[window.length - 1];

  // 1. Pocomos scheduled stops per day+route + which are electric-blower.
  //    Whole week — past days keep whatever next_service_date rows remain.
  const rows = (await sql`
    SELECT next_service_date::text AS d, route_code, pocomos_id
    FROM mosquito_service_status
    WHERE next_service_date >= ${first}::date AND next_service_date <= ${last}::date
  `) as Array<{ d: string; route_code: string | null; pocomos_id: string }>;
  const ebRows = (await sql`
    SELECT pocomos_id FROM customers WHERE tags::text ILIKE ${"%electric blower%"}
  `) as Array<{ pocomos_id: string }>;
  const ebIds = new Set(ebRows.map((r) => String(r.pocomos_id)));

  // (day, normalized daycode) → {stops, eb}
  const pocByDayCode = new Map<string, { stops: number; eb: number }>();
  for (const r of rows) {
    const key = `${r.d}|${normalizeDaycode(r.route_code || "")}`;
    const e = pocByDayCode.get(key) ?? { stops: 0, eb: 0 };
    e.stops++;
    if (ebIds.has(r.pocomos_id)) e.eb++;
    pocByDayCode.set(key, e);
  }
  const ebFor = (date: string, daycode: string) => {
    // A tech's daycode may be "101, 501" — sum EB across its parts.
    let eb = 0;
    for (const part of daycode.split(/[,/]/)) {
      const k = `${date}|${normalizeDaycode(part)}`;
      eb += pocByDayCode.get(k)?.eb ?? 0;
    }
    return eb;
  };

  // 2. Weather + sheet (both timeout-guarded — a slow external call can't stall a TV).
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), ms))]);
  const [forecast, sheet, announcements] = await Promise.all([
    withTimeout(getForecast(), 6000),
    withTimeout(getMasterRoutingSchedule(window), 8000),
    getAnnouncements(),
  ]);
  const wxByDate = new Map((forecast ?? []).map((f) => [f.date, f]));

  const days: BoardDay[] = window.map((date) => {
    const sheetDay: SheetDay | undefined = sheet?.get(date) ?? undefined;
    const wx = wxByDate.get(date) ?? null;

    let rowsOut: BoardRoute[] = [];
    if (sheetDay && sheetDay.rows.length) {
      rowsOut = sheetDay.rows.map((r) => {
        const off = isOffCode(r.daycode, r.tech) ? (r.daycode || r.towns || "OFF").trim() : null;
        const ant = isAntDaycode(r.daycode);
        // Towns: prefer the sheet's label; fall back to the DAYCODES snapshot.
        const towns = r.towns || daycodeArea(r.daycode) || daycodeTowns(r.daycode).slice(0, 2).join(", ");
        return {
          tech: r.tech,
          daycode: r.daycode,
          van: r.van,
          towns,
          stops: r.stops,
          ant,
          electricBlower: off ? 0 : ebFor(date, r.daycode),
          off,
        };
      });
    }

    // Pocomos fallback for days the sheet hasn't filled.
    const fallback = rowsOut.length
      ? []
      : (() => {
          const byCode = new Map<string, { stops: number; eb: number }>();
          for (const r of rows.filter((x) => x.d === date)) {
            const key = normalizeDaycode(r.route_code || "") || "—";
            const e = byCode.get(key) ?? { stops: 0, eb: 0 };
            e.stops++;
            if (ebIds.has(r.pocomos_id)) e.eb++;
            byCode.set(key, e);
          }
          return [...byCode.entries()]
            .map(([daycode, v]) => ({
              daycode,
              area: daycodeArea(daycode),
              stops: v.stops,
              electricBlower: v.eb,
              ant: isAntDaycode(daycode),
            }))
            .sort((a, b) => b.stops - a.stops || a.daycode.localeCompare(b.daycode));
        })();

    const hasAnt = rowsOut.some((r) => r.ant) || fallback.some((r) => r.ant);
    let antRainRisk = false;
    if (hasAnt) {
      for (let k = 0; k <= 2; k++) {
        const w = wxByDate.get(addDays(date, k));
        if (w && w.precip >= RAIN_PROB) antRainRisk = true;
      }
    }

    return {
      date,
      label: weekdayOf(date),
      weekday: weekdayOf(date),
      isToday: date === today,
      rows: rowsOut,
      fallback,
      weather: wx,
      note: sheetDay?.note ?? null,
      antRainRisk,
      fromSheet: rowsOut.length > 0,
    };
  });

  return {
    days,
    announcements,
    sheetConnected: Boolean(sheet && sheet.size > 0),
    asOf: new Date().toISOString(),
    stale: days.every((d) => d.rows.length === 0 && d.fallback.length === 0),
    weekStart: first,
    weekEnd: last,
    weekOverridden,
  };
}
