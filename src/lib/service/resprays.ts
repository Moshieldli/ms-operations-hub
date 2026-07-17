/**
 * /service/resprays — "Tech Respray Performance" (rev 21).
 *
 * SOURCE: the Pocomos **completed-jobs report** (`/completed-jobs-report`) — a
 * Symfony form that POSTs to itself and renders `#results-table` server-side.
 * ONE POST returns the whole year (6,245 rows YTD, ~5.4 MB), so there is no
 * per-customer scrape at all. Columns: Branch | Invoice # | Customer | Address |
 * Job Type | Service Type | Service Frequency | Technician | Completed Date |
 * Production Value | Service Price | Tax | Invoice Total. The Customer cell links
 * to `/customer/{webId}/service-information`, so every row carries the customer
 * id (100% coverage, verified).
 *
 * Flow: GET the form → scrape `completed_jobs_report[_token]` → POST it back with
 * office + start/end dates (**MM/DD/YY**) → parse `#results-table`. READ-ONLY:
 * the form POST is a report render, not a mutation.
 *
 * ATTRIBUTION RULES (ops-defined 2026-07-17 — also stated on the card):
 *  - CURRENT_YEAR only. Prior-year sprays are NEVER used, so a re-service early
 *    in January whose prior spray was last season is "unattributed", not blamed.
 *  - Normal cadence is 11-17 days. A `Re-service` job is a RESPRAY only when it
 *    lands <= RESPRAY_MAX_GAP_DAYS (10) after that customer's most recent prior
 *    completed mosquito APPLICATION this year (Initial/Regular, mosquito-family
 *    service type). It attributes to THAT prior spray's technician.
 *  - Gap >= 11 days → not a respray (that's normal cadence, not the prior tech's
 *    doing) → excluded from respray counts but still shown in the stat boxes.
 *  - No prior application this year → "unattributed" (shown, nobody blamed).
 *  - Rate per tech = attributed resprays ÷ his total mosquito applications YTD.
 */
import { getSyncState, initSchema, setSyncState, sql } from "@/lib/db";
import { CURRENT_YEAR } from "@/lib/pocomos";
import { getPocomosSession, getSessionedHtml, pocomosWebBase } from "@/lib/pocomos/webSession";
import { isMosquitoServiceType } from "./mosquito";

const REPORT_PATH = "/completed-jobs-report";
const REFRESHED_AT_KEY = "resprays_refreshed_at";

/** A Re-service within this many days of the prior spray is that tech's respray. */
export const RESPRAY_MAX_GAP_DAYS = 10;
/** Our normal spray cadence — why 11+ day gaps are NOT resprays. */
export const CADENCE_MIN_DAYS = 11;
export const CADENCE_MAX_DAYS = 17;
/** Job types that count as a mosquito APPLICATION (the rate's denominator). */
export const APPLICATION_JOB_TYPES = new Set(["initial", "regular"]);
export const RESPRAY_JOB_TYPE = "re-service";
/** Flag a tech only with enough volume to be meaningful, and only this far over. */
export const FLAG_MIN_APPLICATIONS = 30;
export const FLAG_RATE_MULTIPLE = 1.5;

export interface RespJob {
  invoiceNo: string;
  customerId: string;
  customerName: string;
  technician: string;
  jobType: string;
  serviceType: string;
  completedDate: string; // ISO YYYY-MM-DD
}

export interface TechWeek {
  weekStart: string; // ISO Monday
  applications: number;
  resprays: number;
  rate: number;
}

export interface TechRow {
  technician: string;
  applications: number;
  resprays: number;
  rate: number; // percent
  /** rate ÷ team average, e.g. 1.8 = 80% worse than the team. */
  vsTeam: number;
  /** True when rate >= FLAG_RATE_MULTIPLE × team avg AND applications >= FLAG_MIN_APPLICATIONS. */
  flagged: boolean;
  weeks: TechWeek[];
}

export interface RespraysReport {
  asOf: string;
  year: string;
  techs: TechRow[];
  totals: {
    /** ALL Re-service jobs on mosquito contracts YTD. */
    reserviceJobs: number;
    /** Re-services within the 10-day window → attributed to a tech. */
    countedResprays: number;
    /** Re-services 11+ days after the prior spray → normal cadence, not counted. */
    excludedGap: number;
    /** Re-services with no prior mosquito application this year. */
    unattributed: number;
    applications: number;
    /** Team rate = countedResprays ÷ applications. */
    teamRate: number;
  };
  stale?: boolean;
}

export interface RespraysRefreshMeta {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  rowsParsed: number;
  mosquitoJobsStored: number;
  totals: RespraysReport["totals"];
}

/** "MM/DD/YYYY" → ISO "YYYY-MM-DD". */
function toIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Report wants MM/DD/YY. */
const toReportDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** ISO Monday of that date's week. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Parse `#results-table` out of the rendered report. */
export function parseJobsReport(html: string): RespJob[] {
  const i = html.indexOf('id="results-table"');
  if (i < 0) return [];
  const seg = html.slice(i, html.indexOf("</table>", i));
  const tb = seg.indexOf("<tbody");
  if (tb < 0) return [];
  const rows = seg.slice(tb).match(/<tr[\s\S]*?<\/tr>/g) || [];
  const out: RespJob[] = [];
  for (const r of rows) {
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
    );
    if (tds.length < 9) continue;
    const customerId = r.match(/\/customer\/(\d+)\//)?.[1];
    const completedDate = toIso(tds[8]);
    if (!customerId || !completedDate) continue;
    out.push({
      invoiceNo: tds[1],
      customerId,
      customerName: tds[2],
      technician: tds[7] || "(unassigned)",
      jobType: tds[4],
      serviceType: tds[5],
      completedDate,
    });
  }
  return out;
}

/** Pull the whole CURRENT_YEAR completed-jobs report in one POST. */
export async function fetchCompletedJobs(): Promise<RespJob[]> {
  const form = await getSessionedHtml(REPORT_PATH);
  const token = form.match(/name="completed_jobs_report\[_token\]"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error("completed-jobs-report: could not read the form _token");

  const body = new URLSearchParams();
  body.set("completed_jobs_report[office][]", process.env.POCOMOS_OFFICE || "1512");
  body.set("completed_jobs_report[startDate]", toReportDate(`${CURRENT_YEAR}-01-01`));
  body.set("completed_jobs_report[endDate]", toReportDate(new Date().toISOString().slice(0, 10)));
  body.set("completed_jobs_report[_token]", token);

  const cookie = await getPocomosSession();
  const res = await fetch(`${pocomosWebBase()}${REPORT_PATH}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ms-operations-hub-sync/1.0",
    },
    body: body.toString(),
    redirect: "manual",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`completed-jobs-report POST failed: ${res.status}`);
  return parseJobsReport(await res.text());
}

const isApplication = (j: RespJob) =>
  APPLICATION_JOB_TYPES.has(j.jobType.trim().toLowerCase()) && isMosquitoServiceType(j.serviceType);
const isReservice = (j: RespJob) =>
  j.jobType.trim().toLowerCase() === RESPRAY_JOB_TYPE && isMosquitoServiceType(j.serviceType);

export interface Attribution {
  job: RespJob;
  /** "counted" = within the window and blamed on `tech`. */
  kind: "counted" | "excluded_gap" | "unattributed";
  tech: string | null;
  gapDays: number | null;
}

/**
 * Attribute every mosquito Re-service to the tech whose spray it followed —
 * but only when it landed inside the window.
 */
export function attribute(jobs: RespJob[]): Attribution[] {
  const byCustomer = new Map<string, RespJob[]>();
  for (const j of jobs) {
    if (!isApplication(j)) continue;
    byCustomer.set(j.customerId, [...(byCustomer.get(j.customerId) || []), j]);
  }
  for (const list of byCustomer.values()) list.sort((a, b) => a.completedDate.localeCompare(b.completedDate));

  const out: Attribution[] = [];
  for (const j of jobs) {
    if (!isReservice(j)) continue;
    const prior = (byCustomer.get(j.customerId) || []).filter((a) => a.completedDate < j.completedDate);
    const last = prior[prior.length - 1];
    if (!last) {
      out.push({ job: j, kind: "unattributed", tech: null, gapDays: null });
      continue;
    }
    const gap = daysBetween(last.completedDate, j.completedDate);
    if (gap <= RESPRAY_MAX_GAP_DAYS) out.push({ job: j, kind: "counted", tech: last.technician, gapDays: gap });
    else out.push({ job: j, kind: "excluded_gap", tech: last.technician, gapDays: gap });
  }
  return out;
}

/** Build the report from stored jobs. */
export function buildReport(jobs: RespJob[], asOf: string): RespraysReport {
  const attributions = attribute(jobs);
  const apps = jobs.filter(isApplication);

  const perTech = new Map<string, { apps: RespJob[]; resprays: Attribution[] }>();
  for (const a of apps) {
    const e = perTech.get(a.technician) ?? { apps: [], resprays: [] };
    e.apps.push(a);
    perTech.set(a.technician, e);
  }
  for (const at of attributions) {
    if (at.kind !== "counted" || !at.tech) continue;
    const e = perTech.get(at.tech) ?? { apps: [], resprays: [] };
    e.resprays.push(at);
    perTech.set(at.tech, e);
  }

  const countedResprays = attributions.filter((a) => a.kind === "counted").length;
  const totalApps = apps.length;
  const teamRate = totalApps ? (countedResprays / totalApps) * 100 : 0;

  const techs: TechRow[] = [...perTech.entries()]
    .map(([technician, e]) => {
      const rate = e.apps.length ? (e.resprays.length / e.apps.length) * 100 : 0;
      // Weekly breakdown: every week the tech sprayed, plus any week he was
      // blamed for a respray.
      const weeks = new Map<string, TechWeek>();
      const bump = (w: string, k: "applications" | "resprays") => {
        const row = weeks.get(w) ?? { weekStart: w, applications: 0, resprays: 0, rate: 0 };
        row[k]++;
        weeks.set(w, row);
      };
      for (const a of e.apps) bump(weekStart(a.completedDate), "applications");
      // A respray belongs to the week of the SPRAY it's blamed on, not its own
      // week — otherwise a Monday respray of a Friday spray lands in the wrong
      // bucket and the weekly rate can exceed 100%.
      for (const r of e.resprays) {
        const prior = jobs
          .filter((j) => isApplication(j) && j.customerId === r.job.customerId && j.completedDate < r.job.completedDate)
          .sort((a, b) => a.completedDate.localeCompare(b.completedDate))
          .pop();
        bump(weekStart(prior?.completedDate ?? r.job.completedDate), "resprays");
      }
      const weekList = [...weeks.values()]
        .map((w) => ({ ...w, rate: w.applications ? (w.resprays / w.applications) * 100 : 0 }))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      return {
        technician,
        applications: e.apps.length,
        resprays: e.resprays.length,
        rate,
        vsTeam: teamRate ? rate / teamRate : 0,
        flagged: e.apps.length >= FLAG_MIN_APPLICATIONS && teamRate > 0 && rate >= teamRate * FLAG_RATE_MULTIPLE,
        weeks: weekList,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.applications - a.applications);

  return {
    asOf,
    year: CURRENT_YEAR,
    techs,
    totals: {
      reserviceJobs: attributions.length,
      countedResprays,
      excludedGap: attributions.filter((a) => a.kind === "excluded_gap").length,
      unattributed: attributions.filter((a) => a.kind === "unattributed").length,
      applications: totalApps,
      teamRate,
    },
  };
}

// -------------------------------------------------------------------- refresh

export async function refreshResprays(): Promise<RespraysRefreshMeta> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  await initSchema();

  const all = await fetchCompletedJobs();
  // Store only mosquito-family jobs — everything the metric can ever need.
  const jobs = all.filter((j) => isMosquitoServiceType(j.serviceType));

  await sql`TRUNCATE respray_jobs`;
  const CHUNK = 1000;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const c = jobs.slice(i, i + CHUNK);
    await sql`
      INSERT INTO respray_jobs
        (invoice_no, customer_id, customer_name, technician, job_type, service_type, completed_date)
      SELECT * FROM UNNEST(
        ${c.map((j) => j.invoiceNo)}::text[], ${c.map((j) => j.customerId)}::text[],
        ${c.map((j) => j.customerName)}::text[], ${c.map((j) => j.technician)}::text[],
        ${c.map((j) => j.jobType)}::text[], ${c.map((j) => j.serviceType)}::text[],
        ${c.map((j) => j.completedDate)}::date[]
      )
      ON CONFLICT (invoice_no) DO NOTHING
    `;
  }
  await setSyncState(REFRESHED_AT_KEY, new Date().toISOString());

  const report = buildReport(jobs, new Date().toISOString());
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    rowsParsed: all.length,
    mosquitoJobsStored: jobs.length,
    totals: report.totals,
  };
}

/** Read the cache and compute the report — no Pocomos calls. */
export async function getRespraysReport(): Promise<RespraysReport> {
  await initSchema();
  const rows = (await sql`
    SELECT invoice_no, customer_id, customer_name, technician, job_type, service_type,
           to_char(completed_date, 'YYYY-MM-DD') AS completed_date
    FROM respray_jobs
  `) as Array<Record<string, string>>;
  const jobs: RespJob[] = rows.map((r) => ({
    invoiceNo: r.invoice_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    technician: r.technician,
    jobType: r.job_type,
    serviceType: r.service_type,
    completedDate: r.completed_date,
  }));
  const asOf = (await getSyncState<string>(REFRESHED_AT_KEY)) ?? new Date().toISOString();
  const report = buildReport(jobs, asOf);
  return { ...report, stale: jobs.length === 0 };
}
