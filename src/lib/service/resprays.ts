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
 * ATTRIBUTION RULES (ops-canonical, rev 24 — 2026-07-17; supersedes the rev-21
 * 10-day window, which is GONE):
 *  - CURRENT_YEAR only. Prior-year jobs are NEVER used.
 *  - A RESPRAY = ANY completed mosquito `Re-service` job this year. No gap
 *    criteria at all — every re-service counts.
 *  - Attribution: blame the technician of the customer's MOST RECENT PRIOR
 *    completed mosquito job this year, where "prior jobs" INCLUDE both
 *    Regular/Initial sprays AND prior Re-services (the CHAIN rule: Nick sprays →
 *    Nathaniel re-services → Daniel re-services again ⇒ Daniel's respray blames
 *    NATHANIEL, the most recent toucher, not the original sprayer).
 *  - No prior mosquito job this year → "unattributed" (shown, nobody blamed).
 *  - Rate per tech = attributed resprays ÷ his total mosquito APPLICATIONS
 *    (Initial + Regular) YTD. (Denominator unchanged — re-services aren't in it.)
 *  - Weekly bucketing stays keyed to the BLAMED job's week.
 */
import { getSyncState, initSchema, setSyncState, sql } from "@/lib/db";
import { CURRENT_YEAR } from "@/lib/pocomos";
import { getPocomosSession, getSessionedHtml, pocomosWebBase } from "@/lib/pocomos/webSession";
import { isMosquitoServiceType } from "./mosquito";

const REPORT_PATH = "/completed-jobs-report";
const REFRESHED_AT_KEY = "resprays_refreshed_at";

/** Job types that count as a mosquito APPLICATION (the rate's denominator). */
export const APPLICATION_JOB_TYPES = new Set(["initial", "regular"]);
export const RESPRAY_JOB_TYPE = "re-service";
/** Flag a tech only with enough volume to be meaningful, and only this far over. */
export const FLAG_MIN_APPLICATIONS = 30;
export const FLAG_RATE_MULTIPLE = 1.5;
/** Minimum applications in a week for a tech to be eligible for a weekly callout. */
export const WEEKLY_CALLOUT_MIN_APPS = 20;

export interface RespJob {
  invoiceNo: string;
  customerId: string;
  customerName: string;
  technician: string;
  jobType: string;
  serviceType: string;
  completedDate: string; // ISO YYYY-MM-DD
}

/**
 * One counted respray, audit-ready: the customer, the prior mosquito job it's
 * blamed on, the re-service that followed, and the gap between them. Lets ops
 * click through to the Pocomos profile and judge whether it was a genuine
 * respray or something else on the account.
 */
export interface ResprayDetail {
  customerId: string;
  customerName: string;
  /** The blamed prior mosquito job's date (ISO). */
  priorJobDate: string;
  /** The blamed prior job's type ("Regular"/"Initial"/"Re-service"). */
  priorJobType: string;
  /** Technician of the blamed prior job (= who this respray is attributed to). */
  priorTech: string;
  /** The re-service that followed, ISO date. */
  reserviceDate: string;
  /** Technician who did the re-service itself. */
  reserviceTech: string;
  /** Whole days between the blamed job and the re-service (informational only now). */
  gapDays: number;
  /** True when the BLAMED prior job was itself a Re-service (a chain respray). */
  chain: boolean;
  /** Re-service invoice # — a stable key. */
  invoiceNo: string;
}

/** A customer with 2+ attributed resprays this year. */
export interface RepeatCustomer {
  customerId: string;
  customerName: string;
  resprays: number;
  /** How many of those were chain resprays (blamed job was a re-service). */
  chainResprays: number;
}

/** Per-tech stats for a single week (weekly leaderboard). */
export interface WeeklyTechStat {
  technician: string;
  applications: number;
  resprays: number;
  rate: number;
}

export interface WeeklyRecap {
  weekStart: string; // ISO Sunday (spray week Sun-Fri)
  label: string; // "This week" / "Last week"
  techs: WeeklyTechStat[];
  totalApps: number;
  totalResprays: number;
  teamRate: number;
  /** Fewest resprays / lowest rate among techs with >= WEEKLY_CALLOUT_MIN_APPS apps. */
  bestRate: WeeklyTechStat | null;
  /** Highest rate among techs with >= WEEKLY_CALLOUT_MIN_APPS apps. */
  needsAttention: WeeklyTechStat | null;
}

export interface WeeklyLeaderboard {
  current: WeeklyRecap;
  lastFull: WeeklyRecap;
  /** Tasteful auto-stats shown to the team (e.g. zero-respray streaks, most improved). */
  funStats: string[];
}

export interface TechWeek {
  weekStart: string; // ISO Sunday (spray week Sun-Fri)
  applications: number;
  resprays: number;
  rate: number;
  /** The counted resprays bucketed into this week (newest re-service first). */
  resprayDetails: ResprayDetail[];
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
  /** Full YTD respray list, newest re-service first — the "All resprays" view. */
  allResprays: ResprayDetail[];
}

export interface RespraysReport {
  asOf: string;
  year: string;
  techs: TechRow[];
  weekly: WeeklyLeaderboard;
  repeatCustomers: RepeatCustomer[];
  totals: {
    /** ALL Re-service jobs on mosquito contracts YTD. */
    reserviceJobs: number;
    /** Re-services with a prior mosquito job → attributed to a tech (= every one that isn't unattributed). */
    countedResprays: number;
    /** Of countedResprays, how many were CHAIN resprays (blamed job was a re-service). */
    chainResprays: number;
    /** Re-services with no prior mosquito job this year. */
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

/**
 * ISO **SUNDAY** of that date's week — the spray week (rev 36, ops).
 *
 * The crew's week runs **Sunday through Friday**: they sometimes spray Sunday
 * and never spray Saturday. So the bucket is Sun–Sat and its Saturday slot is
 * structurally empty. It is kept as a full 7-day bucket deliberately: bucketing
 * Sun–Fri only would make a stray Saturday job (an exception, a data-entry
 * date) fall through the gaps and vanish from every weekly total. Displays say
 * Sun–Fri (see `TechBoard.weekEnd`); the bucket still catches everything.
 *
 * ⚠️ NOT the same week as `categorize.ts::startOfSaturdayWeek`, which is a
 * Sat–Fri week used by the SALES snapshot convention. Different domain, left
 * alone on purpose.
 */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sun=0 → already the start
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
/** Any completed mosquito job — the prior-job pool for the chain rule. */
const isMosquitoJob = (j: RespJob) => isMosquitoServiceType(j.serviceType);

export interface Attribution {
  job: RespJob;
  /** "counted" = a prior mosquito job exists and the respray is blamed on `tech`. */
  kind: "counted" | "unattributed";
  tech: string | null;
  gapDays: number | null;
  /** The blamed prior mosquito job (null = none this year). */
  prior: RespJob | null;
  /** True when `prior` was itself a Re-service (chain respray). */
  chain: boolean;
}

/**
 * Attribute every mosquito Re-service to the tech of the customer's MOST RECENT
 * PRIOR mosquito job this year — INCLUDING prior re-services (chain rule). No
 * gap window: every re-service with a prior job counts. Carries the blamed job
 * so callers (weekly bucketing, detail rows) don't recompute it.
 */
export function attribute(jobs: RespJob[]): Attribution[] {
  // Prior-job pool = ALL mosquito jobs (applications AND re-services), so a
  // re-service can be blamed on the tech who did the previous re-service.
  const byCustomer = new Map<string, RespJob[]>();
  for (const j of jobs) {
    if (!isMosquitoJob(j)) continue;
    byCustomer.set(j.customerId, [...(byCustomer.get(j.customerId) || []), j]);
  }
  for (const list of byCustomer.values()) list.sort((a, b) => a.completedDate.localeCompare(b.completedDate));

  const out: Attribution[] = [];
  for (const j of jobs) {
    if (!isReservice(j)) continue;
    // Most recent mosquito job strictly BEFORE this re-service (any type).
    const prior = (byCustomer.get(j.customerId) || []).filter((a) => a.completedDate < j.completedDate);
    const last = prior[prior.length - 1];
    if (!last) {
      out.push({ job: j, kind: "unattributed", tech: null, gapDays: null, prior: null, chain: false });
      continue;
    }
    out.push({
      job: j,
      kind: "counted",
      tech: last.technician,
      gapDays: daysBetween(last.completedDate, j.completedDate),
      prior: last,
      chain: isReservice(last),
    });
  }
  return out;
}

/** An attribution → an audit-ready detail row. */
function toDetail(a: Attribution): ResprayDetail {
  return {
    customerId: a.job.customerId,
    customerName: a.job.customerName,
    priorJobDate: a.prior!.completedDate,
    priorJobType: a.prior!.jobType,
    priorTech: a.prior!.technician,
    reserviceDate: a.job.completedDate,
    reserviceTech: a.job.technician,
    gapDays: a.gapDays!,
    chain: a.chain,
    invoiceNo: a.job.invoiceNo,
  };
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

  const counted = attributions.filter((a) => a.kind === "counted");
  const countedResprays = counted.length;
  const chainResprays = counted.filter((a) => a.chain).length;
  const totalApps = apps.length;
  const teamRate = totalApps ? (countedResprays / totalApps) * 100 : 0;

  const techs: TechRow[] = [...perTech.entries()]
    .map(([technician, e]) => {
      const rate = e.apps.length ? (e.resprays.length / e.apps.length) * 100 : 0;
      // Weekly breakdown: every week the tech sprayed, plus any week he was
      // blamed for a respray.
      const weeks = new Map<string, TechWeek>();
      const week = (w: string): TechWeek => {
        const row = weeks.get(w) ?? { weekStart: w, applications: 0, resprays: 0, rate: 0, resprayDetails: [] };
        weeks.set(w, row);
        return row;
      };
      for (const a of e.apps) week(weekStart(a.completedDate)).applications++;
      // A respray belongs to the week of the SPRAY it's blamed on, not its own
      // week — otherwise a Sunday/Monday respray of a Friday spray lands in the wrong
      // bucket and the weekly rate can exceed 100%. `prior` is carried on the
      // attribution, so no re-lookup here.
      for (const r of e.resprays) {
        const row = week(weekStart(r.prior?.completedDate ?? r.job.completedDate));
        row.resprays++;
        row.resprayDetails.push(toDetail(r));
      }
      const weekList = [...weeks.values()]
        .map((w) => ({
          ...w,
          rate: w.applications ? (w.resprays / w.applications) * 100 : 0,
          resprayDetails: w.resprayDetails.sort((a, b) => b.reserviceDate.localeCompare(a.reserviceDate)),
        }))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      const allResprays = e.resprays
        .map(toDetail)
        .sort((a, b) => b.reserviceDate.localeCompare(a.reserviceDate));
      return {
        technician,
        applications: e.apps.length,
        resprays: e.resprays.length,
        rate,
        vsTeam: teamRate ? rate / teamRate : 0,
        flagged: e.apps.length >= FLAG_MIN_APPLICATIONS && teamRate > 0 && rate >= teamRate * FLAG_RATE_MULTIPLE,
        weeks: weekList,
        allResprays,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.applications - a.applications);

  // Repeat-respray customers: 2+ attributed resprays this year.
  const byCust = new Map<string, { name: string; resprays: number; chain: number }>();
  for (const a of counted) {
    const e = byCust.get(a.job.customerId) ?? { name: a.job.customerName, resprays: 0, chain: 0 };
    e.resprays++;
    if (a.chain) e.chain++;
    byCust.set(a.job.customerId, e);
  }
  const repeatCustomers: RepeatCustomer[] = [...byCust.entries()]
    .filter(([, e]) => e.resprays >= 2)
    .map(([customerId, e]) => ({
      customerId,
      customerName: e.name,
      resprays: e.resprays,
      chainResprays: e.chain,
    }))
    .sort((a, b) => b.resprays - a.resprays || a.customerName.localeCompare(b.customerName));

  const weekly = buildWeeklyLeaderboard(techs);

  return {
    asOf,
    year: CURRENT_YEAR,
    techs,
    weekly,
    repeatCustomers,
    totals: {
      reserviceJobs: attributions.length,
      countedResprays,
      chainResprays,
      unattributed: attributions.filter((a) => a.kind === "unattributed").length,
      applications: totalApps,
      teamRate,
    },
  };
}

// ---------------------------------------------------- weekly leaderboard

/** ISO Sunday of the week `weeks` before the week starting `sundayIso`. */
function shiftWeek(sundayIso: string, weeksBack: number): string {
  const d = new Date(`${sundayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return d.toISOString().slice(0, 10);
}

/** Today (UTC) — buildReport runs at read time, so this is the viewing day. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pull one week's per-tech stats out of the already-computed TechRow.weeks. */
function weekRecap(techs: TechRow[], targetWeek: string, label: string): WeeklyRecap {
  const stats: WeeklyTechStat[] = [];
  for (const t of techs) {
    const w = t.weeks.find((x) => x.weekStart === targetWeek);
    if (!w || (w.applications === 0 && w.resprays === 0)) continue;
    stats.push({
      technician: t.technician,
      applications: w.applications,
      resprays: w.resprays,
      rate: w.applications ? (w.resprays / w.applications) * 100 : 0,
    });
  }
  stats.sort((a, b) => b.applications - a.applications || a.technician.localeCompare(b.technician));
  const totalApps = stats.reduce((s, x) => s + x.applications, 0);
  const totalResprays = stats.reduce((s, x) => s + x.resprays, 0);
  const eligible = stats.filter((s) => s.applications >= WEEKLY_CALLOUT_MIN_APPS);
  // Best = lowest rate, tie broken by fewest resprays then most apps.
  const bestRate =
    [...eligible].sort(
      (a, b) => a.rate - b.rate || a.resprays - b.resprays || b.applications - a.applications
    )[0] ?? null;
  const needsAttention =
    [...eligible].sort((a, b) => b.rate - a.rate || b.resprays - a.resprays)[0] ?? null;
  return {
    weekStart: targetWeek,
    label,
    techs: stats,
    totalApps,
    totalResprays,
    teamRate: totalApps ? (totalResprays / totalApps) * 100 : 0,
    // Best/attention only meaningful with distinct techs and some spread.
    bestRate: eligible.length >= 2 ? bestRate : null,
    needsAttention: eligible.length >= 2 && needsAttention && needsAttention.resprays > 0 ? needsAttention : null,
  };
}

/**
 * Weekly recap in leaderboard style: current week + last full week, plus a
 * couple of tasteful auto-stats (zero-respray streaks, most-improved).
 */
export function buildWeeklyLeaderboard(techs: TechRow[]): WeeklyLeaderboard {
  const thisWeek = weekStart(todayIso());
  const lastWeek = shiftWeek(thisWeek, 1);
  const current = weekRecap(techs, thisWeek, "This week");
  const lastFull = weekRecap(techs, lastWeek, "Last week");

  const funStats: string[] = [];

  // 1) Longest CURRENT zero-respray streak: consecutive most-recent weeks (with
  //    apps) and 0 resprays, counting back from last full week.
  let streakTech = "";
  let streakLen = 0;
  for (const t of techs) {
    let n = 0;
    for (let k = 1; ; k++) {
      const wk = shiftWeek(thisWeek, k); // last full week and earlier
      const w = t.weeks.find((x) => x.weekStart === wk);
      if (!w || w.applications === 0) break; // streak ends at a week he didn't spray
      if (w.resprays > 0) break;
      n++;
    }
    if (n > streakLen) {
      streakLen = n;
      streakTech = t.technician;
    }
  }
  if (streakLen >= 2) {
    funStats.push(`🎯 ${streakTech} — ${streakLen} weeks straight with zero resprays.`);
  }

  // 2) Most improved week-over-week: biggest rate DROP from two weeks ago to
  //    last full week, both weeks with >= WEEKLY_CALLOUT_MIN_APPS apps.
  const prevWeek = shiftWeek(thisWeek, 2);
  let bestDrop = 0;
  let improvedMsg = "";
  for (const t of techs) {
    const a = t.weeks.find((x) => x.weekStart === prevWeek);
    const b = t.weeks.find((x) => x.weekStart === lastWeek);
    if (!a || !b || a.applications < WEEKLY_CALLOUT_MIN_APPS || b.applications < WEEKLY_CALLOUT_MIN_APPS) continue;
    const ra = (a.resprays / a.applications) * 100;
    const rb = (b.resprays / b.applications) * 100;
    const drop = ra - rb;
    if (drop > bestDrop) {
      bestDrop = drop;
      improvedMsg = `📈 ${t.technician} — most improved: ${ra.toFixed(1)}% → ${rb.toFixed(1)}% week-over-week.`;
    }
  }
  if (bestDrop >= 1) funStats.push(improvedMsg);

  // 3) Perfect week: someone with a solid week (>= callout apps) and zero resprays last week.
  const perfect = lastFull.techs
    .filter((s) => s.applications >= WEEKLY_CALLOUT_MIN_APPS && s.resprays === 0)
    .sort((a, b) => b.applications - a.applications)[0];
  if (perfect) {
    funStats.push(`✨ ${perfect.technician} sprayed ${perfect.applications} last week with zero resprays.`);
  }

  return { current, lastFull, funStats };
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
