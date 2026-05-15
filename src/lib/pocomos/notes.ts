import { getJson, pocomosOffice } from "./client";
import { getSessionedHtml } from "./webSession";

export interface PocomosNote {
  /** ISO date `YYYY-MM-DD`. Empty string when unparseable. */
  date: string;
  /** The note body text. */
  summary: string;
  /** Where the note originated. `pb` is detected via the `📞 PhoneBurner Call —` prefix. */
  source: "pocomos" | "pb";
}

const PB_NOTE_PREFIX = "📞 PhoneBurner Call —";

function classifySource(summary: string): "pocomos" | "pb" {
  return summary.startsWith(PB_NOTE_PREFIX) ? "pb" : "pocomos";
}

function isoDate(input: string | number | Date | null | undefined): string {
  if (input == null || input === "") return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    // Fall back to the first 10 chars if it already looks like YYYY-MM-DD
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}/.test(input)) {
      return input.slice(0, 10);
    }
    return "";
  }
  return d.toISOString().slice(0, 10);
}

interface JsonNote {
  date?: string;
  date_added?: string;
  created_at?: string;
  createdAt?: string;
  summary?: string;
  note?: string;
  body?: string;
  text?: string;
}

function normalizeJsonNote(raw: JsonNote): PocomosNote | null {
  const summary = raw.summary || raw.note || raw.body || raw.text || "";
  if (!summary) return null;
  const date = isoDate(raw.date || raw.date_added || raw.created_at || raw.createdAt || "");
  return { date, summary, source: classifySource(summary) };
}

/** Strip HTML tags + decode common entities. Tiny, no dep. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Pocomos sometimes emits `&nbsp` without the trailing semicolon — accept both.
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&lt;?/gi, "<")
    .replace(/&gt;?/gi, ">")
    .replace(/&quot;?/gi, '"')
    .replace(/&#39;?/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NOISE_LINE = /^(edit|delete|favorite|unfavorite|reply|view|expand|collapse)$/i;
const FULL_TIMESTAMP_LINE = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?$/;
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
// Pocomos auto-prepends `MM/DD/YY H:MM am|pm:` to the body of every UI-typed
// note. The canonical timestamp is already on its own line and used to
// populate `date`, so this prefix is pure noise — strip it.
const AUTO_TIMESTAMP_PREFIX = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(am|pm):\s*/i;

/**
 * Turn the messy multi-line text from a notes-table row into a single
 * cleaned `{ date, summary }`. Pocomos's HTML structure for a note row is:
 *
 *   <body text>
 *   <author name>
 *   (blank)
 *   YYYY-MM-DD HH:MM:SS    ← the canonical timestamp
 *   (blank)
 *   Edit
 *   Delete
 *
 * We prefer the date from the canonical timestamp line; we drop the
 * action-button lines, the timestamp line itself, and any empty lines;
 * then we glue the body and author with an em-dash so the result reads
 * cleanly inside a single PhoneBurner `[Pocomos] DATE — ...` line.
 */
function cleanScrapedRow(rawText: string): { date: string; summary: string } | null {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Prefer the canonical timestamp's date; fall back to the first date-ish hit.
  let date = "";
  for (const l of lines) {
    if (FULL_TIMESTAMP_LINE.test(l)) {
      date = l.slice(0, 10);
      break;
    }
  }
  if (!date) {
    const m = rawText.match(DATE_PATTERN);
    if (m) date = isoDate(m[1]);
  }

  const meaningful = lines.filter(
    (l) => !NOISE_LINE.test(l) && !FULL_TIMESTAMP_LINE.test(l)
  );
  if (meaningful.length === 0) return null;

  const body = meaningful[0].replace(AUTO_TIMESTAMP_PREFIX, "").trim();
  const author = meaningful[1];
  // Anything past line 2 is unexpected leftover — append in parens so we
  // don't silently drop context, but keep the format compact.
  const tail = meaningful.slice(2).join(" ").trim();

  let summary = body;
  if (author) summary += ` — ${author}`;
  if (tail) summary += ` (${tail})`;
  return { date, summary };
}

/**
 * Best-effort HTML scrape of the customer/lead detail page. The Pocomos UI
 * renders the notes panel as a list of date-stamped entries; we look for a
 * date pattern + adjacent text. This is intentionally forgiving — if the
 * markup changes we just return [] and the caller treats the contact as
 * "no notes yet" instead of erroring.
 */
function scrapeNotesFromHtml(html: string): PocomosNote[] {
  const out: PocomosNote[] = [];
  // Attempt 1 — table rows where each <tr> is one note.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const text = stripHtml(m[1]);
    if (!text || !DATE_PATTERN.test(text)) continue;
    const cleaned = cleanScrapedRow(text);
    if (!cleaned) continue;
    out.push({ date: cleaned.date, summary: cleaned.summary, source: classifySource(cleaned.summary) });
  }
  if (out.length) return out;

  // Attempt 2 — fall back to scanning <li> blocks the same way.
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRe.exec(html))) {
    const text = stripHtml(m[1]);
    if (!text || !DATE_PATTERN.test(text)) continue;
    const cleaned = cleanScrapedRow(text);
    if (!cleaned) continue;
    out.push({ date: cleaned.date, summary: cleaned.summary, source: classifySource(cleaned.summary) });
  }
  return out;
}

async function tryJsonNotes(path: string): Promise<PocomosNote[] | null> {
  try {
    const raw = await getJson<unknown>(path);
    let arr: JsonNote[] = [];
    if (Array.isArray(raw)) {
      arr = raw as JsonNote[];
    } else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.response)) arr = obj.response as JsonNote[];
      else if (Array.isArray(obj.notes)) arr = obj.notes as JsonNote[];
      else if (Array.isArray(obj.data)) arr = obj.data as JsonNote[];
      else return null;
    } else {
      return null;
    }
    const notes: PocomosNote[] = [];
    for (const r of arr) {
      const n = normalizeJsonNote(r);
      if (n) notes.push(n);
    }
    return notes;
  } catch {
    // 404 / unauthorized / parse error — let the caller fall back.
    return null;
  }
}

/**
 * Read the note history for a Pocomos customer (`urlId` is the internal
 * routing ID, NOT the user-facing Customer ID — convert via
 * `/customer/find-customer-by-office` first).
 *
 * Tries the JWT JSON endpoint first; falls back to scraping the
 * customer-information HTML page when no JSON is available.
 */
export async function getNotesForCustomer(urlId: string | number): Promise<PocomosNote[]> {
  const office = pocomosOffice();
  const jsonCandidates = [
    `/jwt/pronexis/${office}/customer/${urlId}/notes`,
    `/jwt/pronexis/${office}/customer/${urlId}/note/list`,
    `/jwt/pronexis/customer/${urlId}/notes`,
  ];
  for (const path of jsonCandidates) {
    const notes = await tryJsonNotes(path);
    if (notes && notes.length) return notes;
  }

  // Fall back to HTML scrape (Surface C).
  try {
    const html = await getSessionedHtml(`/customer/${urlId}/customer-information`);
    return scrapeNotesFromHtml(html);
  } catch {
    return [];
  }
}

/**
 * Read the note history for a Pocomos lead. Same JSON-then-HTML strategy
 * as `getNotesForCustomer` but against the lead endpoints.
 */
export async function getNotesForLead(leadId: string | number): Promise<PocomosNote[]> {
  const office = pocomosOffice();
  const jsonCandidates = [
    `/jwt/${office}/lead/${leadId}/notes`,
    `/jwt/${office}/lead/${leadId}/note/list`,
    `/jwt/pronexis/${office}/lead/${leadId}/notes`,
  ];
  for (const path of jsonCandidates) {
    const notes = await tryJsonNotes(path);
    if (notes && notes.length) return notes;
  }

  try {
    const html = await getSessionedHtml(`/lead/${leadId}/lead-information`);
    return scrapeNotesFromHtml(html);
  } catch {
    return [];
  }
}

/**
 * Reverse-chronological sort + 10-most-recent + tail summary line, exactly
 * the format §5.4 of REFERENCE.md mandates. The `pocomosUrl` is the link
 * the tail line points users at when there are >10 notes to read.
 */
export function formatNotesForPhoneBurner(
  notes: PocomosNote[],
  pocomosUrl: string
): string {
  const filtered = notes.filter((n) => n.source !== "pb");
  if (filtered.length === 0) return "";
  const sorted = [...filtered].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const top = sorted.slice(0, 10);
  const lines = top.map((n) => `[Pocomos] ${n.date || "----------"} — ${n.summary}`);
  if (sorted.length > 10) {
    const oldest = sorted[sorted.length - 1].date;
    const oldestYear = oldest && /^\d{4}/.test(oldest) ? oldest.slice(0, 4) : "earlier";
    const extra = sorted.length - 10;
    lines.push(
      `[+ ${extra} older notes from ${oldestYear} — see Pocomos for full history: ${pocomosUrl}]`
    );
  }
  return lines.join("\n");
}

export { PB_NOTE_PREFIX };
