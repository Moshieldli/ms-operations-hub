/**
 * Pre-Pocomos RealGreen history loader (rev 33) — 2021, 2022, 2023.
 *
 * WHY: the return rate had only two points (24→25, 25→26), which is a number,
 * not a trend. These three seasons extend it to FIVE consecutive pairs
 * (21→22 · 22→23 · 23→24 · 24→25 · 25→26) so ops can see direction, not just
 * level.
 *
 * THE KEY DESIGN DECISION — history is computed in RealGreen SHORT-ID space,
 * NOT through `customer_id_map`.
 *
 * The live pairs key on Pocomos web ids, so their job rows go through the id
 * map. That map is built by matching export contact details against the CURRENT
 * Pocomos customer list, so it can only resolve people who still exist in
 * Pocomos. Running 2021 through it would silently drop exactly the population a
 * return-rate DENOMINATOR is made of — customers who churned years ago — and
 * every surviving customer is, by definition, more likely to have returned. The
 * rate would be biased UPWARD by an unknown amount.
 *
 * Both sides of every historical pair live in the same RealGreen export
 * universe and share the short id, so no id translation is needed at all:
 * "real customer of 2021" and "served in 2022" are both answerable directly.
 * `scripts/load-history.ts` reports the mapped-vs-unmapped rate side by side so
 * the size of the bias we avoided is on the record, not assumed.
 *
 * COMPARABILITY CAVEAT — the historical pairs are SPRAY-ONLY. The live pairs
 * also credit a "returned" via an active Pocomos {Y} tag ("signing up is
 * returning"), which has no analogue before Pocomos existed. For a COMPLETED,
 * export-backed season the two paths nearly coincide (a customer who signed up
 * and was actually served shows up in the sprays either way); the loader
 * measures the gap on 24→25, where both methods are computable, and prints it.
 *
 * The mosquito-family filter and the "real customer" rule are the SAME ones the
 * live metric uses — `REALGREEN_MOSQUITO_CODES` and rule 1 (>=2 services, or
 * exactly 1 after Aug 15) — imported, not re-implemented, so history and live
 * can never drift apart.
 *
 * READ-ONLY against Pocomos (this path never touches it at all).
 */
import { initSchema, sql } from "@/lib/db";
import { isLateSeasonSpray, REAL_CUSTOMER_MIN_SERVICES } from "@/lib/sales-taxonomy";
import { columnIndex, parseCsvRow, parseExportDate, splitCsvLines } from "./exportCsv";
import { REALGREEN_MOSQUITO_CODES, type JobRow } from "./exportLoad";

/** The pre-Pocomos seasons loaded from RealGreen "spray dates" exports. */
export const HISTORY_YEARS = [2021, 2022, 2023] as const;

export interface HistoryLoadReport {
  year: number;
  file: string;
  rowsParsed: number;
  rowsLoaded: number;
  mosquitoJobs: number;
  nonMosquitoJobs: number;
  badDate: number;
  badId: number;
  blankRows: number;
  /** Jobs whose DoneDate year != the file's year (the export is not perfectly bounded). */
  offYearJobs: number;
  distinctCustomers: number;
  mosquitoCustomers: number;
  byCategory: Record<string, number>;
}

/**
 * Parse ONE "{year} spray dates.csv" and land it in `realgreen_jobs_history`.
 *
 * Format notes vs `realgreen_jobs_2024.csv` (same 153-column report, exported
 * with different settings):
 *  - line endings are a SINGLE \r, not \r\r — `splitCsvLines` already covers both.
 *  - dates are `M/D/YYYY 0:00` (24h) not `M/D/YYYY 12:00:00 AM` — `parseExportDate`
 *    only reads the leading date, so both parse identically.
 *  - there is a FULLY-BLANK comma-only row between every data row. Those are not
 *    whitespace, so the splitter keeps them; they're counted as `blankRows` and
 *    skipped explicitly rather than being lumped into `badId`, which would make
 *    the load report look 50% broken.
 */
export async function loadRealgreenHistoryYear(
  raw: string,
  year: number,
  file: string
): Promise<{ report: HistoryLoadReport; jobs: JobRow[] }> {
  const lines = splitCsvLines(raw);
  const header = parseCsvRow(lines[0]);
  const at = columnIndex(header);
  const jobs: JobRow[] = [];
  const customers = new Set<string>();
  const byCategory: Record<string, number> = {};
  let badDate = 0;
  let badId = 0;
  let blankRows = 0;
  let offYearJobs = 0;
  const rows: Array<Record<string, string | null>> = [];

  for (const line of lines.slice(1)) {
    // The interleaved separator rows are all commas and nothing else.
    if (!/[^,\s]/.test(line)) {
      blankRows++;
      continue;
    }
    const r = parseCsvRow(line);
    const shortId = (r[at("CustomerNumber")] || "").trim();
    if (!shortId || shortId === "0") {
      badId++;
      continue;
    }
    const code = (r[at("ProgramOrServiceCode")] || "").trim();
    const date = parseExportDate(r[at("DoneDate")] || "");
    if (!date) {
      badDate++;
      continue;
    }
    if (!date.startsWith(String(year))) offYearJobs++;

    const mosquito = code in REALGREEN_MOSQUITO_CODES;
    byCategory[code || "(blank)"] = (byCategory[code || "(blank)"] || 0) + 1;
    jobs.push({ shortId, date, mosquito });
    customers.add(shortId);

    rows.push({
      short_id: shortId,
      customer_name: r[at("CustomerName")] || null,
      first_name: r[at("FirstName")] || null,
      last_name: r[at("LastName")] || null,
      email: r[at("EmailAddress")] || null,
      phone: r[at("PreferredPhoneNumber")] || null,
      address: r[at("Address")] || null,
      zip: r[at("ZipCode")] || null,
      done_date: date,
      program_or_service_code: code || null,
      source_code: r[at("SourceCode")] || null,
      source_description: r[at("SourceDescription")] || null,
      route_code: r[at("RouteCode")] || null,
      since_date: parseExportDate(r[at("SinceDate")] || ""),
      billing_type_description: r[at("BillingTypeDescription")] || null,
    });
  }

  // Reloadable: clear only THIS year, so one bad file can be re-pulled alone.
  await sql`DELETE FROM realgreen_jobs_history WHERE year = ${year}`;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const c = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO realgreen_jobs_history
        (year, short_id, customer_name, first_name, last_name, email, phone, address, zip,
         done_date, program_or_service_code, source_code, source_description, route_code,
         since_date, billing_type_description)
      SELECT ${year}, * FROM UNNEST(
        ${c.map((r) => r.short_id)}::text[], ${c.map((r) => r.customer_name)}::text[],
        ${c.map((r) => r.first_name)}::text[], ${c.map((r) => r.last_name)}::text[],
        ${c.map((r) => r.email)}::text[], ${c.map((r) => r.phone)}::text[],
        ${c.map((r) => r.address)}::text[], ${c.map((r) => r.zip)}::text[],
        ${c.map((r) => r.done_date)}::date[], ${c.map((r) => r.program_or_service_code)}::text[],
        ${c.map((r) => r.source_code)}::text[], ${c.map((r) => r.source_description)}::text[],
        ${c.map((r) => r.route_code)}::text[], ${c.map((r) => r.since_date)}::date[],
        ${c.map((r) => r.billing_type_description)}::text[]
      )
    `;
  }

  const mosquitoJobs = jobs.filter((j) => j.mosquito).length;
  return {
    jobs,
    report: {
      year,
      file,
      rowsParsed: lines.length - 1 - blankRows,
      rowsLoaded: rows.length,
      mosquitoJobs,
      nonMosquitoJobs: jobs.length - mosquitoJobs,
      badDate,
      badId,
      blankRows,
      offYearJobs,
      distinctCustomers: customers.size,
      mosquitoCustomers: new Set(jobs.filter((j) => j.mosquito).map((j) => j.shortId)).size,
      byCategory,
    },
  };
}

/**
 * Per-customer mosquito spray dates for ONE year, keyed by short id.
 * Only mosquito-family jobs dated inside `year` count — the exports carry a
 * few stragglers from adjacent seasons.
 */
export function sprayDatesByShortId(jobs: JobRow[], year: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const j of jobs) {
    if (!j.mosquito) continue;
    if (!j.date.startsWith(String(year))) continue;
    out.set(j.shortId, [...(out.get(j.shortId) || []), j.date]);
  }
  return out;
}

/**
 * Rule 1 — "real customer of year Y", the SAME definition the live metric uses:
 * >= REAL_CUSTOMER_MIN_SERVICES completed mosquito services, OR exactly one
 * that landed after the late-season cutoff (too late in the season to have had
 * a second).
 */
export function isRealFromDates(dates: string[] | undefined): boolean {
  if (!dates || dates.length === 0) return false;
  if (dates.length >= REAL_CUSTOMER_MIN_SERVICES) return true;
  return isLateSeasonSpray([...dates].sort()[0]);
}

export interface HistoryPair {
  fromYear: number;
  toYear: number;
  realFrom: number;
  returned: number;
  rate: number;
  lateSignupsFrom: number;
}

/**
 * One historical pair, entirely in short-id space: of the real customers of
 * `fromYear`, how many were real customers of `toYear`?
 *
 * Spray-only on both sides — see the file header's comparability note.
 */
export function computeHistoryPair(
  from: Map<string, string[]>,
  to: Map<string, string[]>,
  fromYear: number,
  toYear: number
): HistoryPair {
  let realFrom = 0;
  let returned = 0;
  let lateSignupsFrom = 0;
  for (const [shortId, dates] of from) {
    if (!isRealFromDates(dates)) continue;
    realFrom++;
    if (dates.length === 1) lateSignupsFrom++;
    if (isRealFromDates(to.get(shortId))) returned++;
  }
  return {
    fromYear,
    toYear,
    realFrom,
    returned,
    rate: realFrom ? Math.round((returned / realFrom) * 10000) / 100 : 0,
    lateSignupsFrom,
  };
}

/** Freeze the computed pairs into `return_rate_history` (upsert per from-year). */
export async function saveHistoryPairs(pairs: HistoryPair[]): Promise<void> {
  await initSchema();
  for (const p of pairs) {
    await sql`
      INSERT INTO return_rate_history
        (from_year, to_year, real_from, returned, rate, late_signups_from, built_at)
      VALUES (${p.fromYear}, ${p.toYear}, ${p.realFrom}, ${p.returned}, ${p.rate},
              ${p.lateSignupsFrom}, NOW())
      ON CONFLICT (from_year) DO UPDATE SET
        to_year = EXCLUDED.to_year,
        real_from = EXCLUDED.real_from,
        returned = EXCLUDED.returned,
        rate = EXCLUDED.rate,
        late_signups_from = EXCLUDED.late_signups_from,
        built_at = NOW()
    `;
  }
}

/** Read the frozen historical pairs, oldest first. */
export async function getHistoryPairs(): Promise<HistoryPair[]> {
  const rows = (await sql`
    SELECT from_year, to_year, real_from, returned, rate, late_signups_from
    FROM return_rate_history
    ORDER BY from_year
  `) as Array<{
    from_year: number;
    to_year: number;
    real_from: number;
    returned: number;
    rate: string | number;
    late_signups_from: number;
  }>;
  return rows.map((r) => ({
    fromYear: r.from_year,
    toYear: r.to_year,
    realFrom: r.real_from,
    returned: r.returned,
    rate: Number(r.rate),
    lateSignupsFrom: r.late_signups_from,
  }));
}
