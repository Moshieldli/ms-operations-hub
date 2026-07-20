/**
 * Schedule board data (rev 45) — the `/tv/board` digital route schedule.
 *
 * Built from what POCOMOS provides now, per the ops instruction (the Master
 * Routing sheet's live read is dormant until the Drive/Sheets APIs are enabled):
 *   - `mosquito_service_status` — each customer's `next_service_date` +
 *     `route_code` (== the sheet's daycode). Grouped per day, per route, this IS
 *     the live schedule Pocomos knows: which routes run each day and how many
 *     stops.
 *   - `routeTowns.ts` — the DAYCODES → towns/area snapshot from the sheet.
 *   - Open-Meteo forecast — the weather strip (shared with /tv/techs).
 *   - The `NT - Electric Blower Only` customer tag — read live from the dataset.
 *
 * WHEN THE SHEET IS ENABLED, `masterRouting.ts` overlays the per-day TECH names
 * and the ANT-day assignments onto each route; until then techs show blank and
 * ANT markers are dormant. Everything degrades gracefully.
 *
 * v1 is DISPLAY-ONLY. No writes anywhere.
 */
import { sql } from "@/lib/db";
import { getForecast, type ForecastDay } from "@/lib/weather";
import { daycodeArea, daycodeTowns, isAntDaycode, normalizeDaycode } from "./routeTowns";
import { getMasterRoutingSchedule } from "./masterRouting";

/** Rain if the max precip probability reaches this, for the ant dry-day check. */
const RAIN_PROB = 55;

export interface RouteStop {
  daycode: string;
  area: string;
  towns: string[];
  stops: number;
  /** Tech from the sheet overlay, when available. */
  tech: string | null;
  ant: boolean;
}

export interface BoardDay {
  date: string;
  /** "Today" / "Mon" / … */
  label: string;
  weekday: string;
  routes: RouteStop[];
  totalStops: number;
  weather: ForecastDay | null;
  /** Any scheduled customer that day carries the Electric-Blower tag. */
  electricBlower: number;
  /** Free-text note from the sheet (RAIN/sick/swap), when the sheet is read. */
  note: string | null;
  /**
   * True when the day has an ANT route AND rain falls within the 3-day window
   * (service day, day+1, day+2). "Ant needs 3 dry days." Only computable with
   * the sheet overlay (ANT assignment) + forecast reach.
   */
  antRainRisk: boolean;
}

export interface ScheduleBoard {
  days: BoardDay[];
  /** True when the live routing sheet is feeding tech names / ANT markers. */
  sheetConnected: boolean;
  asOf: string;
  stale: boolean;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso: string) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** Eastern "today" (the board runs at read time; use the same clock as overdue). */
function easternToday(): string {
  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${eastern.getFullYear()}-${String(eastern.getMonth() + 1).padStart(2, "0")}-${String(
    eastern.getDate()
  ).padStart(2, "0")}`;
}

/** Today + the next 4 WORKDAYS (Sun–Fri; the crew never works Saturday). */
function workdayWindow(today: string): string[] {
  const out: string[] = [];
  let d = today;
  while (out.length < 5) {
    if (weekdayOf(d) !== "Sat") out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export async function getScheduleBoard(): Promise<ScheduleBoard> {
  const today = easternToday();
  const window = workdayWindow(today);
  const last = window[window.length - 1];

  // 1. Scheduled stops per day+route from the mosquito-status cache.
  const rows = (await sql`
    SELECT next_service_date::text AS d, route_code, pocomos_id
    FROM mosquito_service_status
    WHERE next_service_date >= ${today}::date AND next_service_date <= ${last}::date
  `) as Array<{ d: string; route_code: string | null; pocomos_id: string }>;

  // 2. Electric-blower customer ids — a fast tag query on the enriched
  //    `customers` cache (NOT getDataset, which rebuilds the whole ~80s Pocomos
  //    roster; the board must read instantly).
  const ebRows = (await sql`
    SELECT pocomos_id FROM customers WHERE tags::text ILIKE ${"%electric blower%"}
  `) as Array<{ pocomos_id: string }>;
  const ebIds = new Set(ebRows.map((r) => String(r.pocomos_id)));

  // 3. Weather + (dormant) sheet overlay. Both are wrapped so a slow/hung
  //    external call can never stall the TV board — it just renders without them.
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      p.catch(() => null),
      new Promise<null>((res) => setTimeout(() => res(null), ms)),
    ]);
  const [forecast, sheet] = await Promise.all([
    withTimeout(getForecast(), 6000),
    withTimeout(getMasterRoutingSchedule(window), 6000),
  ]);
  const wxByDate = new Map((forecast ?? []).map((f) => [f.date, f]));

  const days: BoardDay[] = window.map((date, i) => {
    const dayRows = rows.filter((r) => r.d === date);
    const byCode = new Map<string, { stops: number; eb: number }>();
    for (const r of dayRows) {
      const key = normalizeDaycode(r.route_code || "") || "—";
      const e = byCode.get(key) ?? { stops: 0, eb: 0 };
      e.stops++;
      if (ebIds.has(r.pocomos_id)) e.eb++;
      byCode.set(key, e);
    }
    const overlay = sheet?.get(date);
    // Reverse the sheet's tech→daycode so we can label a route with its tech.
    const daycodeToTech = new Map<string, string>();
    if (overlay) {
      for (const [tech, code] of Object.entries(overlay.techToDaycode)) {
        for (const part of code.split(/[,/]/)) {
          const nc = normalizeDaycode(part);
          if (nc) daycodeToTech.set(nc, tech);
        }
      }
    }
    const routes: RouteStop[] = [...byCode.entries()]
      .map(([daycode, v]) => ({
        daycode,
        area: daycodeArea(daycode),
        towns: daycodeTowns(daycode),
        stops: v.stops,
        tech: daycodeToTech.get(daycode) ?? null,
        ant: isAntDaycode(daycode),
      }))
      .sort((a, b) => b.stops - a.stops || a.daycode.localeCompare(b.daycode));

    // ANT dry-day check: an ant route today needs no rain over 3 days.
    const hasAnt = routes.some((r) => r.ant);
    let antRainRisk = false;
    if (hasAnt) {
      for (let k = 0; k <= 2; k++) {
        const wx = wxByDate.get(addDays(date, k));
        if (wx && wx.precip >= RAIN_PROB) antRainRisk = true;
      }
    }

    return {
      date,
      label: i === 0 ? "Today" : weekdayOf(date),
      weekday: weekdayOf(date),
      routes,
      totalStops: dayRows.length,
      weather: wxByDate.get(date) ?? null,
      electricBlower: dayRows.filter((r) => ebIds.has(r.pocomos_id)).length,
      note: overlay?.note ?? null,
      antRainRisk,
    };
  });

  return {
    days,
    sheetConnected: Boolean(sheet && sheet.size > 0),
    asOf: new Date().toISOString(),
    stale: rows.length === 0,
  };
}
