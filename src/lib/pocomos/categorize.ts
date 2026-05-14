import type { Bucket } from "./types";

const CURRENT_YEAR = String(new Date().getFullYear());

/**
 * Bucket assignment from a customer's unioned year tags.
 *
 * Rules (per 2026 product spec):
 *  - "{year} - New Sale" tag means this customer made a (re)sign this year.
 *    - If they ALSO have any prior YYYY tag (e.g. "2024 - Auto"), they were
 *      a customer before — RETURNING.
 *    - If no prior YYYY tag, they're brand new — NEW.
 *  - No "{year} - New Sale" tag:
 *    - If they have a continuation tag for {year} (Auto / SEB / EB / Prepaid /
 *      Committed), service rolled into the new year — RETAINED.
 *    - If they only have prior YYYY tags, the year hasn't been renewed yet —
 *      AT_RISK.
 *    - Otherwise null (untagged for the year — no bucket).
 *
 * Note: "{year} - Renewed" was removed. That tag doesn't exist in Pocomos;
 * the previous categorize logic checked for it and would have always missed.
 */
export function bucketFor(tags: Set<string>, year: string): Bucket | null {
  const hasNew = tags.has(`${year} - New Sale`);
  const hasAuto = tags.has(`${year} - Auto`);
  const hasSEB = tags.has(`${year} - SEB`);
  const hasEB = tags.has(`${year} - EB`);
  const hasOther =
    tags.has(`${year} - Prepaid`) || tags.has(`${year} - Committed`);
  const hasContinuation = hasAuto || hasSEB || hasEB || hasOther;
  const hasPriorYear = Array.from(tags).some((t) => {
    const m = t.match(/^(\d{4}) -/);
    return m != null && m[1] < year;
  });

  if (hasNew) return hasPriorYear ? "RETURNING" : "NEW";
  if (hasContinuation) return "RETAINED";
  if (hasPriorYear) return "AT_RISK";
  return null;
}

/** Sat-Fri week per the existing dashboard convention. */
export function startOfSaturdayWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
  return date;
}

export { CURRENT_YEAR };
