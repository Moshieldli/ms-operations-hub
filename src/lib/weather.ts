/**
 * Open-Meteo daily forecast for the shop TV weather strip (rev 29).
 *
 * DISPLAY ONLY — nothing operational reads this. It exists so the Yodeck layout
 * can drop its separate weather app and run one webpage widget instead.
 *
 * Open-Meteo is free and needs NO API key. Probed 2026-07-19 against
 * lat 40.61 / lon -73.71 (Lawrence, Nassau County NY); the API snaps to its grid
 * point at 40.597/-73.702, which is the same neighbourhood. Response shape is
 * parallel arrays under `daily` — `time[]`, `weather_code[]`,
 * `temperature_2m_max[]`, `temperature_2m_min[]`, `precipitation_probability_max[]`.
 *
 * CACHING: a module-level memo, NOT Next's fetch cache. The page that renders
 * this sets `fetchCache = "force-no-store"` (it also reads mutable Neon caches),
 * which would force every fetch in the segment to bypass Next's cache — so the
 * TTL has to live here. Best-effort per serverless instance: a cold instance
 * refetches. That is fine at this volume (one TV reloading every 10 min).
 * FAIL-SOFT: any error returns null and the strip is simply omitted — the
 * weather must never take down the tech board.
 */

/** Lawrence / Nassau County, NY — the shop's service area. */
export const WEATHER_LAT = 40.61;
export const WEATHER_LON = -73.71;
export const WEATHER_PLACE = "Lawrence, NY";

const TTL_MS = 30 * 60 * 1000;

export interface ForecastDay {
  /** ISO date, e.g. "2026-07-19". */
  date: string;
  /** "Today", then "Mon"/"Tue"/… */
  label: string;
  /**
   * Raw WMO weather code (rev 35). Was an emoji string; the TV renders an
   * inline SVG chosen from this code in `components/tv-icons.tsx`, because
   * Yodeck's Linux browser has no color-emoji font and drew empty boxes.
   */
  code: number;
  high: number;
  low: number;
  /** Max precipitation probability, percent. */
  precip: number;
}

let memo: { at: number; days: ForecastDay[] } | null = null;

/*
 * The old WMO-code → emoji map lived here. It's gone (rev 35): the code is now
 * passed through raw and mapped to an inline SVG in `components/tv-icons.tsx`,
 * where the same bands (clear, cloud, fog, drizzle, rain, snow, storm) are
 * preserved. See that file for why emoji can't be used on the shop TVs.
 */

/** "2026-07-20" → "Mon" (UTC-safe: the ISO date is already the local calendar day). */
function dayLabel(iso: string, index: number): string {
  if (index === 0) return "Today";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/**
 * Today + the next 4 days. Returns null on any failure — callers omit the strip.
 */
export async function getForecast(): Promise<ForecastDay[] | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.days;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=5`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = (await res.json()) as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };
    const d = j.daily;
    if (!d?.time?.length) throw new Error("open-meteo: no daily block");

    const days: ForecastDay[] = d.time.map((date, i) => ({
      date,
      label: dayLabel(date, i),
      code: d.weather_code?.[i] ?? -1,
      high: Math.round(d.temperature_2m_max?.[i] ?? 0),
      low: Math.round(d.temperature_2m_min?.[i] ?? 0),
      precip: Math.round(d.precipitation_probability_max?.[i] ?? 0),
    }));

    memo = { at: Date.now(), days };
    return days;
  } catch (e) {
    console.error("[weather] forecast unavailable:", e);
    // Serve a stale memo if we have one — an old forecast beats a blank strip.
    return memo?.days ?? null;
  }
}
