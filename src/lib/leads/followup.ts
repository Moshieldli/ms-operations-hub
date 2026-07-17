/**
 * /leads/followup — "Overdue Follow-ups" (rev 20).
 *
 * Surfaces OPEN leads created THIS YEAR that are falling through the cracks in
 * follow-up. Same shape as /service/overdue: a nightly cron fills a Neon cache
 * (`leads_followup`) and the page reads that instantly; "Refresh now" re-scrapes.
 *
 * SCOPE (deliberately narrow — it bounds the scrape): `status = "Lead"` AND
 * `date_added` in CURRENT_YEAR. Not Interested / Monitor / converted are out.
 * Live scope 2026-07-17: **288 leads** of 3,081 in the open-leads feed.
 *
 * DATA MODEL (probed 2026-07-17):
 *  - Bulk feed `POST /leads/data` (legacy DataTables 1.9 — see leadSync.ts and
 *    the documented gotchas) returns EVERYTHING we need about the lead itself:
 *    id, name, status, date_added, salesperson, email, phone, marketing_type_name
 *    and — usefully — `reason`/`reason_name` (the Not-Interested reason). So
 *    status + reason need NO per-lead scrape; the /lead/{id}/lead-information
 *    page is never touched.
 *  - The follow-up trail lives in lead TASKS on `/lead/{id}/message-board`,
 *    which is SERVER-RENDERED — one GET per lead, no AJAX:
 *      #todo-table         → OPEN tasks (Priority | Description | Status | Type |
 *                            Assigned By | Date Due). Due cell carries a
 *                            machine-readable `data-order="YYYY-MM-DD HH:MM"`.
 *      #history-todo-table → COMPLETED/archived tasks (no Status column).
 *    A `<span class="comments-count">…N</span>` inside the description cell is
 *    the TOUCH COUNT. The comment TIMESTAMPS are not on the board, so the last
 *    touch date needs one extra GET per commented task:
 *      `/message/todo/{taskId}/show` → `.comment__author` / `.comment__date`
 *      ("Posted on Jul 16, 2026 11:37 AM") / `.comment__body`.
 *    Cost: ~288 board GETs + ~1 show GET per commented task ≈ 550 requests at
 *    concurrency 5 — the same order as the mosquito scrape.
 *
 * READ-ONLY. GET + the established DataTables-read POST only. NEVER touch
 * `/todos/{id}/complete` (mark-complete) or `/message/todo/new` — both are
 * mutations that appear right next to the data we read.
 */
import { getSyncState, initSchema, setSyncState, sql } from "@/lib/db";
import { CURRENT_YEAR, fetchPooled } from "@/lib/pocomos";
import { getSessionedHtml, postSessioned } from "@/lib/pocomos/webSession";

const REFRESHED_AT_KEY = "leads_followup_refreshed_at";
const SCRAPE_CONCURRENCY = 5; // Pocomos hard cap
const PER_REQUEST_PAUSE_MS = 120;
const PAGE_SIZE = 200;

/** Legacy DataTables 1.9 column list for /leads/data — order is load-bearing. */
const LEADS_COLUMNS = [
  "name_with_company",
  "address",
  "phone",
  "map_code",
  "status",
  "date_added",
  "salesperson",
  "note",
  "function",
] as const;

export type FollowupBucket = "overdue" | "no_task" | "no_open_task" | "on_track";

export interface FollowupLead {
  leadId: string;
  name: string;
  createdDate: string | null; // ISO YYYY-MM-DD
  salesperson: string | null;
  marketingType: string | null;
  phone: string | null;
  email: string | null;
  bucket: FollowupBucket;
  /** Comment count on the open task (or the newest archived one) = # touches. */
  touches: number;
  /** Last comment timestamp, ISO. Null = never touched beyond task creation. */
  lastTouchAt: string | null;
  /** Open task's due date, ISO. Null when there's no open task. */
  taskDueAt: string | null;
  /** Whole days past due (>=1 only when overdue). */
  daysOverdue: number | null;
  taskStatus: string | null;
  taskDescription: string | null;
  openTaskCount: number;
  archivedTaskCount: number;
  /** PhoneBurner calls seen for this lead (via the pb_contact_id bridge). */
  pbCalls: number;
  pbLastCallAt: string | null;
}

export interface FollowupReport {
  asOf: string;
  year: string;
  leads: FollowupLead[];
  counts: {
    scope: number;
    overdue: number;
    noTask: number;
    noOpenTask: number;
    onTrack: number;
    /** Of overdue+no-task: how many have ANY PhoneBurner call activity. */
    withPbActivity: number;
  };
  /** Populated when the cache is empty and the page had to say so. */
  stale?: boolean;
}

export interface FollowupRefreshMeta {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scope: number;
  boardsScraped: number;
  taskDetailsScraped: number;
  failed: number;
  counts: FollowupReport["counts"];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Strip tags → plain text. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** "Jul 16, 2026 11:37 AM" → ISO "2026-07-16T11:37:00". */
export function parseCommentDate(raw: string): string | null {
  const m = raw.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mo = months.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  let h = parseInt(m[4], 10) % 12;
  if (/pm/i.test(m[6])) h += 12;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[5]}:00`;
}

/** Eastern-ish "today" as ISO date — matches how ops reads a due date. */
function todayIso(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ------------------------------------------------------------------ bulk feed

function leadsBody(start: number): URLSearchParams {
  const b = new URLSearchParams();
  b.set("sEcho", "1");
  b.set("iColumns", String(LEADS_COLUMNS.length));
  b.set("sColumns", LEADS_COLUMNS.join(","));
  b.set("iDisplayStart", String(start));
  b.set("iDisplayLength", String(PAGE_SIZE));
  LEADS_COLUMNS.forEach((c, i) => {
    b.set(`mDataProp_${i}`, c);
    b.set(`sSearch_${i}`, "");
    b.set(`bRegex_${i}`, "false");
    b.set(`bSearchable_${i}`, "true");
    b.set(`bSortable_${i}`, "true");
  });
  b.set("sSearch", "");
  b.set("bRegex", "false");
  b.set("iSortCol_0", String(LEADS_COLUMNS.indexOf("date_added")));
  b.set("sSortDir_0", "desc");
  b.set("iSortingCols", "1");
  return b;
}

interface RawLead {
  id?: string | number;
  name?: string;
  name_with_company?: string;
  status?: string;
  date_added?: string;
  salesperson?: string;
  email?: string;
  phone?: string;
  marketing_type_name?: string;
}

/** Every OPEN lead created in CURRENT_YEAR — the scrape scope. */
export async function fetchScopeLeads(): Promise<RawLead[]> {
  const out: RawLead[] = [];
  const first = await postSessioned<{ aaData?: RawLead[]; iTotalRecords?: number }>(
    "/leads/data",
    leadsBody(0)
  );
  out.push(...(first.aaData || []));
  const total = Number(first.iTotalRecords || 0);
  for (let s = PAGE_SIZE; s < total; s += PAGE_SIZE) {
    const p = await postSessioned<{ aaData?: RawLead[] }>("/leads/data", leadsBody(s));
    out.push(...(p.aaData || []));
  }
  return out.filter(
    (l) =>
      String(l.status || "").trim().toLowerCase() === "lead" &&
      String(l.date_added || "").startsWith(CURRENT_YEAR)
  );
}

// ------------------------------------------------------------- board scraping

export interface ParsedTask {
  taskId: string;
  priority: string;
  description: string;
  status: string | null; // open tasks only
  type: string;
  assignedBy: string;
  /** ISO "YYYY-MM-DDTHH:MM" from the due cell's data-order, else null. */
  dueAt: string | null;
  comments: number;
  open: boolean;
}

/** Rows of one table id, as raw <tr> HTML. */
function tableRows(html: string, tableId: string): string[] {
  const i = html.indexOf(`id="${tableId}"`);
  if (i < 0) return [];
  const end = html.indexOf("</table>", i);
  const seg = html.slice(i, end === -1 ? undefined : end);
  const bodyStart = seg.indexOf("<tbody");
  if (bodyStart < 0) return [];
  return seg.slice(bodyStart).match(/<tr[\s\S]*?<\/tr>/g) || [];
}

/** Parse both task tables off a /lead/{id}/message-board page. */
export function parseTasks(html: string): ParsedTask[] {
  const out: ParsedTask[] = [];
  const take = (rows: string[], open: boolean) => {
    for (const tr of rows) {
      const taskId = tr.match(/data-id="(\d+)"/)?.[1];
      if (!taskId) continue;
      const tds = tr.match(/<td[\s\S]*?<\/td>/g) || [];
      if (!tds.length) continue;
      // The due cell is the one carrying data-order (machine-readable).
      const dueCell = tds.find((t) => /data-order="/.test(t));
      const dueAt = dueCell?.match(/data-order="([^"]+)"/)?.[1]?.replace(" ", "T") ?? null;
      const comments = parseInt(
        tr.match(/class="comments-count"[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1]?.replace(/,/g, "") || "0",
        10
      );
      // Column order differs between the two tables (open has an extra Status).
      const cells = tds.map(text);
      out.push({
        taskId,
        priority: cells[0] || "",
        description: (tr.match(/description-cell-inner"[^>]*>([\s\S]*?)(?:<span class="comments-count"|<\/div>)/)?.[1]
          ? text(tr.match(/description-cell-inner"[^>]*>([\s\S]*?)(?:<span class="comments-count"|<\/div>)/)![1])
          : cells[1] || ""),
        status: open ? cells[2] || null : null,
        type: open ? cells[3] || "" : cells[2] || "",
        assignedBy: open ? cells[4] || "" : cells[3] || "",
        dueAt,
        comments: Number.isFinite(comments) ? comments : 0,
        open,
      });
    }
  };
  take(tableRows(html, "todo-table"), true);
  take(tableRows(html, "history-todo-table"), false);
  return out;
}

/** Newest comment timestamp on a task detail page. */
export function parseLastComment(html: string): { at: string | null; count: number } {
  const dates = [...html.matchAll(/class="comment__date"[^>]*>\s*Posted on ([^<]+)</g)]
    .map((m) => parseCommentDate(m[1].trim()))
    .filter(Boolean) as string[];
  dates.sort();
  return { at: dates.length ? dates[dates.length - 1] : null, count: dates.length };
}

// ------------------------------------------------------------------- refresh

export async function refreshLeadsFollowup(): Promise<FollowupRefreshMeta> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  await initSchema();

  const scope = await fetchScopeLeads();
  const today = todayIso();

  // PhoneBurner activity: webhook_log has NO usable pocomos_id (NULL on every
  // row), so bridge through phoneburner_contacts on pb_contact_id.
  const pbRows = (await sql`
    SELECT pc.pocomos_id, COUNT(*)::int AS calls, MAX(w.received_at) AS last_call
    FROM webhook_log w
    JOIN phoneburner_contacts pc ON pc.pb_contact_id = w.pb_contact_id
    WHERE pc.pocomos_type = 'lead'
    GROUP BY pc.pocomos_id
  `) as Array<{ pocomos_id: string; calls: number; last_call: string | Date | null }>;
  const pb = new Map(
    pbRows.map((r) => [
      String(r.pocomos_id),
      {
        calls: Number(r.calls),
        last: r.last_call instanceof Date ? r.last_call.toISOString() : r.last_call ? String(r.last_call) : null,
      },
    ])
  );

  let boardsScraped = 0;
  let taskDetailsScraped = 0;
  const results: FollowupLead[] = [];

  const one = async (l: RawLead): Promise<void> => {
    const leadId = String(l.id);
    await sleep(PER_REQUEST_PAUSE_MS);
    const html = await getSessionedHtml(`/lead/${leadId}/message-board`);
    boardsScraped++;
    const tasks = parseTasks(html);
    const open = tasks.filter((t) => t.open && String(t.status || "").toLowerCase() !== "completed");
    const archived = tasks.filter((t) => !t.open);

    // The task that defines the lead's next step: the soonest-due open task.
    // Falling back through open-without-a-date → newest archived keeps the
    // description/status columns populated for the no-open-task bucket.
    const dued = open.filter((t) => t.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    const newestArchived = [...archived].sort((a, b) => (b.dueAt ?? "").localeCompare(a.dueAt ?? ""))[0];
    const primary = dued[0] ?? open[0] ?? newestArchived ?? null;

    // TOUCHES = every comment across EVERY task on the lead, not just the open
    // one. The team normally keeps one rolling task per lead (they push its due
    // date out after each touch), but a lead whose task was completed and
    // replaced would otherwise under-report its history. The comment TIMESTAMPS
    // aren't on the board, so each commented task costs one extra GET.
    let lastTouchAt: string | null = null;
    let touches = 0;
    for (const t of tasks) {
      if (t.comments <= 0) {
        continue;
      }
      await sleep(PER_REQUEST_PAUSE_MS);
      const detail = await getSessionedHtml(`/message/todo/${t.taskId}/show`);
      taskDetailsScraped++;
      const parsed = parseLastComment(detail);
      touches += parsed.count || t.comments;
      if (parsed.at && (!lastTouchAt || parsed.at > lastTouchAt)) lastTouchAt = parsed.at;
    }

    const dueIso = dued[0]?.dueAt?.slice(0, 10) ?? null;
    let bucket: FollowupBucket;
    let daysOverdue: number | null = null;
    if (tasks.length === 0) bucket = "no_task";
    else if (!dued.length) bucket = "no_open_task"; // every task completed/archived
    else {
      const d = daysBetween(dueIso!, today);
      if (d > 0) {
        bucket = "overdue";
        daysOverdue = d;
      } else bucket = "on_track";
    }

    const p = pb.get(leadId);
    results.push({
      leadId,
      name: String(l.name || l.name_with_company || leadId).trim(),
      createdDate: String(l.date_added || "").slice(0, 10) || null,
      salesperson: l.salesperson || null,
      marketingType: l.marketing_type_name || null,
      phone: l.phone || null,
      email: l.email || null,
      bucket,
      touches,
      lastTouchAt,
      taskDueAt: dued[0]?.dueAt ?? null,
      daysOverdue,
      taskStatus: primary?.status ?? null,
      taskDescription: primary?.description?.slice(0, 300) ?? null,
      openTaskCount: open.length,
      archivedTaskCount: archived.length,
      pbCalls: p?.calls ?? 0,
      pbLastCallAt: p?.last ?? null,
    });
  };

  const pooled = await fetchPooled(scope, one, { concurrency: SCRAPE_CONCURRENCY });

  const counts = tally(results);
  await writeFollowupCache(results);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    scope: scope.length,
    boardsScraped,
    taskDetailsScraped,
    failed: pooled.failures.length,
    counts,
  };
}

function tally(leads: FollowupLead[]): FollowupReport["counts"] {
  return {
    scope: leads.length,
    overdue: leads.filter((l) => l.bucket === "overdue").length,
    noTask: leads.filter((l) => l.bucket === "no_task").length,
    noOpenTask: leads.filter((l) => l.bucket === "no_open_task").length,
    onTrack: leads.filter((l) => l.bucket === "on_track").length,
    withPbActivity: leads.filter(
      (l) => (l.bucket === "overdue" || l.bucket === "no_task") && l.pbCalls > 0
    ).length,
  };
}

// --------------------------------------------------------------------- cache

async function writeFollowupCache(leads: FollowupLead[]): Promise<void> {
  await sql`TRUNCATE leads_followup`;
  const CHUNK = 500;
  for (let i = 0; i < leads.length; i += CHUNK) {
    const c = leads.slice(i, i + CHUNK);
    await sql`
      INSERT INTO leads_followup (
        lead_id, name, created_date, salesperson, marketing_type, phone, email,
        bucket, touches, last_touch_at, task_due_at, days_overdue, task_status,
        task_description, open_task_count, archived_task_count, pb_calls, pb_last_call_at
      )
      SELECT * FROM UNNEST(
        ${c.map((l) => l.leadId)}::text[], ${c.map((l) => l.name)}::text[],
        ${c.map((l) => l.createdDate)}::date[], ${c.map((l) => l.salesperson)}::text[],
        ${c.map((l) => l.marketingType)}::text[], ${c.map((l) => l.phone)}::text[],
        ${c.map((l) => l.email)}::text[], ${c.map((l) => l.bucket)}::text[],
        ${c.map((l) => l.touches)}::int[], ${c.map((l) => l.lastTouchAt)}::timestamptz[],
        ${c.map((l) => l.taskDueAt)}::timestamptz[], ${c.map((l) => l.daysOverdue)}::int[],
        ${c.map((l) => l.taskStatus)}::text[], ${c.map((l) => l.taskDescription)}::text[],
        ${c.map((l) => l.openTaskCount)}::int[], ${c.map((l) => l.archivedTaskCount)}::int[],
        ${c.map((l) => l.pbCalls)}::int[], ${c.map((l) => l.pbLastCallAt)}::timestamptz[]
      )
    `;
  }
  // sync_state.value is JSONB — go through the helper, which encodes it.
  await setSyncState(REFRESHED_AT_KEY, new Date().toISOString());
}

const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Read the cache — instant; never scrapes. */
export async function getFollowupReport(): Promise<FollowupReport> {
  await initSchema();
  const rows = (await sql`
    SELECT * FROM leads_followup
    ORDER BY days_overdue DESC NULLS LAST, created_date ASC
  `) as Array<Record<string, unknown>>;
  const refreshedAt = await getSyncState<string>(REFRESHED_AT_KEY);
  const leads: FollowupLead[] = rows.map((r) => ({
    leadId: String(r.lead_id),
    name: String(r.name ?? ""),
    createdDate: iso(r.created_date)?.slice(0, 10) ?? null,
    salesperson: (r.salesperson as string) ?? null,
    marketingType: (r.marketing_type as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    bucket: r.bucket as FollowupBucket,
    touches: Number(r.touches ?? 0),
    lastTouchAt: iso(r.last_touch_at),
    taskDueAt: iso(r.task_due_at),
    daysOverdue: r.days_overdue == null ? null : Number(r.days_overdue),
    taskStatus: (r.task_status as string) ?? null,
    taskDescription: (r.task_description as string) ?? null,
    openTaskCount: Number(r.open_task_count ?? 0),
    archivedTaskCount: Number(r.archived_task_count ?? 0),
    pbCalls: Number(r.pb_calls ?? 0),
    pbLastCallAt: iso(r.pb_last_call_at),
  }));
  return {
    asOf: refreshedAt ?? new Date().toISOString(),
    year: CURRENT_YEAR,
    leads,
    counts: tally(leads),
    stale: leads.length === 0,
  };
}
