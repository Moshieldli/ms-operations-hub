/**
 * Bulk-export loader (rev 18) — the AUTHORITATIVE source of per-year mosquito
 * spray counts for completed seasons.
 *
 *   2024 ← data/realgreen_jobs_2024.csv   (RealGreen; the pre-Pocomos era)
 *   2025 ← data/completed_jobs_2025.csv   (Pocomos completed-jobs export)
 *   2026 ← still the nightly service-history scrape (season in progress)
 *
 * WHY exports beat the scrape: the per-customer service-history table renders
 * only the customer's DEFAULT contract, so a customer whose season sits on an
 * older/cancelled contract shows phantom zeroes (the multi-contract blind spot,
 * §5.8). These exports are job-level and contract-agnostic, so they see every
 * completed job regardless of which contract it hung off.
 *
 * Mosquito-family filter:
 *   2025 — `Agreement` ∈ MOSQUITO_SERVICE_TYPES (Mosquito Control, Natural
 *          Mosquito Control, + their "- Weekly" variants). This drops Event
 *          Spray / Trial Spray / Free Spray and every tick/ant/fly/lanternfly
 *          agreement by construction.
 *   2024 — RealGreen `ProgramOrServiceCode` ∈ {12, 12N, 24, 24N}. All four are
 *          mosquito programs (empirically cross-tabulated against the same
 *          customers' 2025 agreements: 12→Mosquito 98.8%, 12N→Natural 98.1%,
 *          24→Mosquito-Weekly 100%, 24N→Natural-Weekly 100%; codes are
 *          visit-count programs — 12-visit vs 24-visit/weekly — with N =
 *          Natural). RealGreen carries NO event/one-off code, so nothing else
 *          to exclude. `ServiceCode`/`ProgramType` are 100% blank in the export.
 *
 * READ-ONLY against Pocomos (the id map reads the customer list; nothing else).
 */
import { initSchema, sql } from "@/lib/db";
import { MOSQUITO_SERVICE_TYPES } from "./mosquito";
import { columnIndex, normEmail, parseCsvRow, parseExportDate, splitCsvLines } from "./exportCsv";
import { buildIdMap, saveIdMap, type ExportContact } from "./idMap";

export const EXPORT_YEARS = [2024, 2025] as const;

/**
 * RealGreen program codes → the Pocomos agreement they correspond to. ALL are
 * mosquito-family (validated by cross-tab, see file header). Codes are
 * visit-count programs; the trailing "N" means Natural.
 */
export const REALGREEN_MOSQUITO_CODES: Record<string, string> = {
  "12": "Mosquito Control",
  "12N": "Natural Mosquito Control",
  "24": "Mosquito Control - Weekly",
  "24N": "Natural Mosquito Control - Weekly",
};

export interface JobRow {
  shortId: string;
  date: string; // ISO YYYY-MM-DD
  mosquito: boolean;
}

export interface LoadReport {
  file: string;
  rowsParsed: number;
  rowsLoaded: number;
  mosquitoJobs: number;
  nonMosquitoJobs: number;
  badDate: number;
  badId: number;
  distinctCustomers: number;
  mosquitoCustomers: number;
  byCategory: Record<string, number>;
}

const isMosquitoAgreement = (a: string): boolean =>
  MOSQUITO_SERVICE_TYPES.has(String(a || "").trim().toLowerCase());

// ---------------------------------------------------------------- 2025 (Pocomos)

export async function loadCompletedJobs2025(raw: string): Promise<{
  report: LoadReport;
  jobs: JobRow[];
  contacts: ExportContact[];
}> {
  const lines = splitCsvLines(raw);
  const header = parseCsvRow(lines[0]);
  const at = columnIndex(header);
  const jobs: JobRow[] = [];
  const contacts = new Map<string, ExportContact>();
  const byCategory: Record<string, number> = {};
  let badDate = 0;
  let badId = 0;
  const rows: Array<Record<string, string | null>> = [];

  for (const line of lines.slice(1)) {
    const r = parseCsvRow(line);
    const shortId = (r[at("Customer Id")] || "").trim();
    if (!shortId || shortId === "0") {
      badId++;
      continue;
    }
    const agreement = (r[at("Agreement")] || "").trim();
    const date = parseExportDate(r[at("Completed Date")] || "");
    if (!date) {
      badDate++;
      continue;
    }
    const mosquito = isMosquitoAgreement(agreement);
    byCategory[agreement || "(blank)"] = (byCategory[agreement || "(blank)"] || 0) + 1;
    jobs.push({ shortId, date, mosquito });

    const full = (r[at("Customer")] || "").trim();
    const sp = full.lastIndexOf(" ");
    if (!contacts.has(shortId))
      contacts.set(shortId, {
        shortId,
        first: sp > 0 ? full.slice(0, sp) : full,
        last: sp > 0 ? full.slice(sp + 1) : "",
        email: r[at("Customer Email Address")] || "",
        phone: r[at("Customer Phone Number")] || "",
        zip: r[at("Zip Code")] || "",
      });

    rows.push({
      invoice_no: r[at("Invoice #")] || null,
      short_id: shortId,
      customer_name: full || null,
      email: r[at("Customer Email Address")] || null,
      phone: r[at("Customer Phone Number")] || null,
      address: r[at("Address")] || null,
      zip: r[at("Zip Code")] || null,
      job_type: r[at("Job Type")] || null,
      lot_size: r[at("Lot Size")] || null,
      service_type: r[at("Service Type")] || null,
      service_frequency: r[at("Service Frequency")] || null,
      agreement: agreement || null,
      technician: r[at("Technician")] || null,
      completed_date: date,
      branch: r[at("Branch")] || null,
    });
  }

  await sql`TRUNCATE completed_jobs_2025`;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const c = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO completed_jobs_2025
        (invoice_no, short_id, customer_name, email, phone, address, zip, job_type,
         lot_size, service_type, service_frequency, agreement, technician, completed_date, branch)
      SELECT * FROM UNNEST(
        ${c.map((r) => r.invoice_no)}::text[], ${c.map((r) => r.short_id)}::text[],
        ${c.map((r) => r.customer_name)}::text[], ${c.map((r) => r.email)}::text[],
        ${c.map((r) => r.phone)}::text[], ${c.map((r) => r.address)}::text[],
        ${c.map((r) => r.zip)}::text[], ${c.map((r) => r.job_type)}::text[],
        ${c.map((r) => r.lot_size)}::text[], ${c.map((r) => r.service_type)}::text[],
        ${c.map((r) => r.service_frequency)}::text[], ${c.map((r) => r.agreement)}::text[],
        ${c.map((r) => r.technician)}::text[], ${c.map((r) => r.completed_date)}::date[],
        ${c.map((r) => r.branch)}::text[]
      )
    `;
  }

  const mosquitoJobs = jobs.filter((j) => j.mosquito).length;
  return {
    jobs,
    contacts: [...contacts.values()],
    report: {
      file: "completed_jobs_2025.csv",
      rowsParsed: lines.length - 1,
      rowsLoaded: rows.length,
      mosquitoJobs,
      nonMosquitoJobs: jobs.length - mosquitoJobs,
      badDate,
      badId,
      distinctCustomers: contacts.size,
      mosquitoCustomers: new Set(jobs.filter((j) => j.mosquito).map((j) => j.shortId)).size,
      byCategory,
    },
  };
}

// -------------------------------------------------------------- 2024 (RealGreen)

export async function loadRealgreenJobs2024(raw: string): Promise<{
  report: LoadReport;
  jobs: JobRow[];
  contacts: ExportContact[];
}> {
  const lines = splitCsvLines(raw);
  const header = parseCsvRow(lines[0]);
  const at = columnIndex(header);
  const jobs: JobRow[] = [];
  const contacts = new Map<string, ExportContact>();
  const byCategory: Record<string, number> = {};
  let badDate = 0;
  let badId = 0;
  const rows: Array<Record<string, string | null>> = [];

  for (const line of lines.slice(1)) {
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
    const mosquito = code in REALGREEN_MOSQUITO_CODES;
    byCategory[code || "(blank)"] = (byCategory[code || "(blank)"] || 0) + 1;
    jobs.push({ shortId, date, mosquito });

    if (!contacts.has(shortId))
      contacts.set(shortId, {
        shortId,
        first: r[at("FirstName")] || "",
        last: r[at("LastName")] || "",
        email: r[at("EmailAddress")] || "",
        phone: r[at("PreferredPhoneNumber")] || "",
        zip: r[at("ZipCode")] || "",
      });

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
      service_code: r[at("ServiceCode")] || null,
      program_type: r[at("ProgramType")] || null,
      source_code: r[at("SourceCode")] || null,
      source_description: r[at("SourceDescription")] || null,
      route_code: r[at("RouteCode")] || null,
      program_route_code: r[at("ProgramRouteCode")] || null,
      since_date: parseExportDate(r[at("SinceDate")] || ""),
      customer_last_service_date: parseExportDate(r[at("CustomerLastServiceDate")] || ""),
      discount_code: r[at("DiscountCode")] || null,
      billing_type_description: r[at("BillingTypeDescription")] || null,
    });
  }

  await sql`TRUNCATE realgreen_jobs_2024`;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const c = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO realgreen_jobs_2024
        (short_id, customer_name, first_name, last_name, email, phone, address, zip,
         done_date, program_or_service_code, service_code, program_type, source_code,
         source_description, route_code, program_route_code, since_date,
         customer_last_service_date, discount_code, billing_type_description)
      SELECT * FROM UNNEST(
        ${c.map((r) => r.short_id)}::text[], ${c.map((r) => r.customer_name)}::text[],
        ${c.map((r) => r.first_name)}::text[], ${c.map((r) => r.last_name)}::text[],
        ${c.map((r) => r.email)}::text[], ${c.map((r) => r.phone)}::text[],
        ${c.map((r) => r.address)}::text[], ${c.map((r) => r.zip)}::text[],
        ${c.map((r) => r.done_date)}::date[], ${c.map((r) => r.program_or_service_code)}::text[],
        ${c.map((r) => r.service_code)}::text[], ${c.map((r) => r.program_type)}::text[],
        ${c.map((r) => r.source_code)}::text[], ${c.map((r) => r.source_description)}::text[],
        ${c.map((r) => r.route_code)}::text[], ${c.map((r) => r.program_route_code)}::text[],
        ${c.map((r) => r.since_date)}::date[], ${c.map((r) => r.customer_last_service_date)}::date[],
        ${c.map((r) => r.discount_code)}::text[], ${c.map((r) => r.billing_type_description)}::text[]
      )
    `;
  }

  const mosquitoJobs = jobs.filter((j) => j.mosquito).length;
  return {
    jobs,
    contacts: [...contacts.values()],
    report: {
      file: "realgreen_jobs_2024.csv",
      rowsParsed: lines.length - 1,
      rowsLoaded: rows.length,
      mosquitoJobs,
      nonMosquitoJobs: jobs.length - mosquitoJobs,
      badDate,
      badId,
      distinctCustomers: contacts.size,
      mosquitoCustomers: new Set(jobs.filter((j) => j.mosquito).map((j) => j.shortId)).size,
      byCategory,
    },
  };
}

// ------------------------------------------------------- counts rebuild (2024+2025)

export interface CountsWriteReport {
  year: number;
  customersWithCounts: number;
  jobsCounted: number;
  jobsDroppedUnmapped: number;
  unmappedShortIds: number;
  /** Stale scrape-sourced rows evicted from this export-owned year. */
  staleScrapeRowsRemoved: number;
}

/**
 * Rebuild `mosquito_service_counts` rows for ONE export-backed year from job
 * rows. Deletes only that year's `source='export'` rows first, so the nightly
 * CY scrape is untouched.
 */
export async function writeExportCounts(
  year: number,
  jobs: JobRow[],
  idMap: Map<string, string>
): Promise<CountsWriteReport> {
  const perCustomer = new Map<string, string[]>(); // pocomos_id → ISO dates
  let jobsCounted = 0;
  let jobsDroppedUnmapped = 0;
  const unmapped = new Set<string>();

  for (const j of jobs) {
    if (!j.mosquito) continue;
    if (!j.date.startsWith(String(year))) continue;
    const web = idMap.get(j.shortId);
    if (!web) {
      jobsDroppedUnmapped++;
      unmapped.add(j.shortId);
      continue;
    }
    perCustomer.set(web, [...(perCustomer.get(web) || []), j.date]);
    jobsCounted++;
  }

  // A customer can be sprayed twice on one date only via distinct jobs; the
  // metric counts SERVICES, so keep every job row (no date de-dup).
  const ids: string[] = [];
  const counts: number[] = [];
  const firsts: string[] = [];
  const lasts: string[] = [];
  for (const [web, dates] of perCustomer) {
    const sorted = [...dates].sort();
    ids.push(web);
    counts.push(sorted.length);
    firsts.push(sorted[0]);
    lasts.push(sorted[sorted.length - 1]);
  }

  // INVARIANT: an export-backed year contains ONLY export rows.
  //
  // Old scrape rows for this year are evicted, not merged. They came from the
  // per-customer service-history table, which renders only a customer's DEFAULT
  // contract and therefore under-reports any season sitting on an older or
  // cancelled contract — the very defect this export replaces. Mixing the two
  // would leave a minority of customers silently scored on the broken source,
  // and `exportYears` would advertise them as authoritative. If a customer isn't
  // in the export, they had no mosquito job that year.
  const staleRows = (await sql`
    SELECT COUNT(*)::int AS n FROM mosquito_service_counts
    WHERE year = ${year} AND source = 'scrape'
  `) as Array<{ n: number }>;
  const staleScrapeRowsRemoved = staleRows[0]?.n ?? 0;
  await sql`DELETE FROM mosquito_service_counts WHERE year = ${year} AND source <> 'export'`;
  await sql`DELETE FROM mosquito_service_counts WHERE year = ${year} AND source = 'export'`;
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const s = (a: unknown[]) => a.slice(i, i + CHUNK);
    await sql`
      INSERT INTO mosquito_service_counts
        (pocomos_id, year, service_count, first_service_date, last_service_date, source)
      SELECT u.id, ${year}, u.cnt, u.first, u.last, 'export'
      FROM UNNEST(
        ${s(ids)}::text[], ${s(counts)}::int[], ${s(firsts)}::date[], ${s(lasts)}::date[]
      ) AS u(id, cnt, first, last)
      ON CONFLICT (pocomos_id, year) DO UPDATE SET
        service_count = EXCLUDED.service_count,
        first_service_date = EXCLUDED.first_service_date,
        last_service_date = EXCLUDED.last_service_date,
        source = 'export'
    `;
  }

  return {
    year,
    customersWithCounts: ids.length,
    jobsCounted,
    jobsDroppedUnmapped,
    unmappedShortIds: unmapped.size,
    staleScrapeRowsRemoved,
  };
}

/** Full pipeline: parse both exports → build+save id map → rebuild 2024/2025 counts. */
export async function loadExportsAndRebuildCounts(files: {
  jobs2025: string;
  jobs2024: string;
}): Promise<{
  reports: LoadReport[];
  idMap: { total: number; byMethod: Record<string, number>; unresolved: number; apiCustomers: number };
  counts: CountsWriteReport[];
  unresolvedSample: Array<{ shortId: string; reason: string }>;
}> {
  await initSchema();
  const a = await loadCompletedJobs2025(files.jobs2025);
  const b = await loadRealgreenJobs2024(files.jobs2024);

  // One map over BOTH exports' contacts (they share the short-id space; 2024-only
  // churned customers must map too or the 24→25 denominator loses them).
  const merged = new Map<string, ExportContact>();
  for (const c of [...b.contacts, ...a.contacts]) {
    const prev = merged.get(c.shortId);
    // Prefer the record with an email, then the 2025 one (fresher contact info).
    if (!prev || (!normEmail(prev.email) && normEmail(c.email))) merged.set(c.shortId, c);
  }
  const map = await buildIdMap([...merged.values()]);
  await saveIdMap(map.entries);
  const idMap = new Map(map.entries.map((e) => [e.shortId, e.pocomosId]));

  const counts = [
    await writeExportCounts(2024, b.jobs, idMap),
    await writeExportCounts(2025, a.jobs, idMap),
  ];

  return {
    reports: [b.report, a.report],
    idMap: {
      total: map.entries.length,
      byMethod: map.byMethod,
      unresolved: map.unresolved.length,
      apiCustomers: map.apiCustomers,
    },
    counts,
    unresolvedSample: map.unresolved.slice(0, 10).map((u) => ({ shortId: u.shortId, reason: u.reason })),
  };
}
