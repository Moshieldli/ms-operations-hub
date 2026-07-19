/**
 * Cadence health (rev 37) — what share of the gaps between a customer's
 * consecutive mosquito services fall OUTSIDE the target service window.
 *
 * WHY THIS EXISTS: the 2025 spray-count investigation (§5.17) found that the
 * drop from ~10 sprays per customer to ~8.6 was NOT an export artifact — the
 * whole interval distribution shifted right (median gap 13d → 15d) and 2026 is
 * continuing it. That is a capacity/routing signal, and a longer gap is exactly
 * when mosquitoes come back, so it plausibly feeds the five-season retention
 * decline. This turns that one-off finding into a number ops can watch live.
 *
 * DEFINITION — "beyond the window" is strictly **> 17 days**. The target window
 * is 11–17 days inclusive, so a 17-day gap is ON TARGET and does not count.
 * (Careful: an earlier ad-hoc analysis reported a ">17 days" figure that was
 * actually >=17 — 12.3% / 35.4% / 38.7% for 2024/2025/2026. The strict
 * definition used here gives 9.1% / 27.8% / 31.1%. Same shape, ~3× worse across
 * three seasons; different absolute level. Don't mix the two.)
 *
 * Gaps are computed per customer within a single season, so no short-id ↔ web-id
 * conversion is needed — each year is self-consistent in its own id space.
 */
import { sql } from "@/lib/db";
import { MOSQUITO_SERVICE_TYPES } from "./mosquito";
import { REALGREEN_MOSQUITO_CODES } from "./exportLoad";

/** Target service window, inclusive, in days. A gap > max is "beyond". */
export const CADENCE_WINDOW = { min: 11, max: 17 } as const;

export interface CadenceYear {
  year: number;
  /** Intervals measured (one per consecutive pair, so services − customers). */
  gaps: number;
  /** Of those, how many exceeded CADENCE_WINDOW.max. */
  beyond: number;
  /** beyond / gaps, percent. */
  pct: number;
  /** True for the in-progress season — the figure moves as the season runs. */
  live: boolean;
}

const pct = (beyond: number, gaps: number) =>
  gaps ? Math.round((beyond / gaps) * 1000) / 10 : 0;

/**
 * Cadence for the CURRENT season, from the job rows the respray report already
 * holds in memory — no extra query, and it tracks live as the season fills in.
 */
export function cadenceFromJobs(
  jobs: Array<{ customerId: string; completedDate: string }>,
  year: number
): CadenceYear {
  const byCustomer = new Map<string, string[]>();
  for (const j of jobs) {
    if (!j.completedDate.startsWith(String(year))) continue;
    byCustomer.set(j.customerId, [...(byCustomer.get(j.customerId) || []), j.completedDate]);
  }
  let gaps = 0;
  let beyond = 0;
  for (const [, dates] of byCustomer) {
    const sorted = [...dates].sort();
    for (let i = 1; i < sorted.length; i++) {
      const d = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000;
      gaps++;
      if (d > CADENCE_WINDOW.max) beyond++;
    }
  }
  return { year, gaps, beyond, pct: pct(beyond, gaps), live: true };
}

/**
 * Cadence for the two COMPLETED export-backed seasons (2024 RealGreen, 2025
 * Pocomos). Computed in Postgres with LAG so we never pull 25k job rows into
 * the request just to diff dates. These seasons are closed, so the numbers are
 * fixed — they exist to give the live figure something to be judged against.
 */
export async function priorSeasonCadence(): Promise<CadenceYear[]> {
  const codes = Object.keys(REALGREEN_MOSQUITO_CODES);
  const types = [...MOSQUITO_SERVICE_TYPES];
  const max = CADENCE_WINDOW.max;

  const r24 = (await sql`
    WITH j AS (
      SELECT short_id AS id, done_date AS d
      FROM realgreen_jobs_2024
      WHERE program_or_service_code = ANY(${codes}::text[])
        AND done_date >= '2024-01-01' AND done_date < '2025-01-01'
    ), g AS (
      SELECT (d - LAG(d) OVER (PARTITION BY id ORDER BY d)) AS gap FROM j
    )
    SELECT COUNT(gap)::int AS gaps,
           COUNT(*) FILTER (WHERE gap > ${max})::int AS beyond
    FROM g
  `) as Array<{ gaps: number; beyond: number }>;

  const r25 = (await sql`
    WITH j AS (
      SELECT short_id AS id, completed_date AS d
      FROM completed_jobs_2025
      WHERE LOWER(agreement) = ANY(${types}::text[])
        AND completed_date >= '2025-01-01' AND completed_date < '2026-01-01'
    ), g AS (
      SELECT (d - LAG(d) OVER (PARTITION BY id ORDER BY d)) AS gap FROM j
    )
    SELECT COUNT(gap)::int AS gaps,
           COUNT(*) FILTER (WHERE gap > ${max})::int AS beyond
    FROM g
  `) as Array<{ gaps: number; beyond: number }>;

  const mk = (year: number, r: { gaps: number; beyond: number } | undefined): CadenceYear => ({
    year,
    gaps: r?.gaps ?? 0,
    beyond: r?.beyond ?? 0,
    pct: pct(r?.beyond ?? 0, r?.gaps ?? 0),
    live: false,
  });
  return [mk(2024, r24[0]), mk(2025, r25[0])];
}
