/**
 * Pure parsing layer for PhoneBurner `api_calldone` (Call End) webhooks.
 *
 * Lives separately from the route so scripts/test-webhook.ts can exercise
 * the field-extraction + note-formatting logic without spinning up a real
 * HTTP listener. The route is just a thin wrapper that handles auth,
 * persistence, and the Pocomos write call.
 *
 * Field map (RE-verified against LIVE api_calldone payloads 2026-07-21,
 * webhook_log 294/295 — the earlier map wrongly placed custom fields under
 * `contact`, which is why webhook_log.pocomos_id was NULL on every historical
 * row and no webhook note write ever fired):
 *
 *   status                              → call disposition (string)
 *   duration                            → seconds (number or string)
 *   recording_url_public                → preferred recording URL
 *   recording_url                       → fallback recording URL
 *   agent.first_name + agent.last_name  → CSR name
 *   contact.user_id                     → PhoneBurner contact ID
 *   typed_custom_fields[]  (TOP LEVEL)  → array of {type,name,value};
 *                                          we look for name === "Customer ID"
 *   custom_fields          (TOP LEVEL)  → flat {name: value} object (or FALSE)
 *   folder                 (TOP LEVEL)  → {id, name} of the dialed folder
 *   contact.notes                       → FULL history string, newline-separated.
 *                                          Each entry starts with "-- DATE @ TIME [TZ] -- "
 *                                          and PB prepends, so the first entry is the latest.
 */

export interface PBAgent {
  first_name?: string;
  last_name?: string;
  name?: string;
}

export interface PBTypedCustomField {
  type?: number | string;
  name?: string;
  value?: string;
}

export interface PBContact {
  user_id?: string | number;
  notes?: string;
  custom_fields?: Record<string, string>;
  typed_custom_fields?: PBTypedCustomField[];
  /** Folder the contact sits in at call time — wellness-queue detection. */
  category?: { category_id?: string | number; name?: string };
}

export interface PBCallDonePayload {
  status?: string;
  duration?: number | string;
  recording_url_public?: string;
  recording_url?: string;
  agent?: PBAgent;
  contact?: PBContact;
  /**
   * ⚠️ REAL wire shape (verified against live payloads 2026-07-21, webhook_log
   * 294/295): custom fields and the dial folder arrive at the PAYLOAD TOP
   * LEVEL, NOT under `contact`. `contact.typed_custom_fields` does not exist on
   * the wire — the earlier field map was wrong, which is why
   * webhook_log.pocomos_id was NULL on all 293 historical rows (rev 20).
   */
  typed_custom_fields?: PBTypedCustomField[];
  custom_fields?: Record<string, unknown> | false;
  /** The folder the dial session ran from, e.g. {id:"66255089", name:"Wellness — Queue 2026"}. */
  folder?: { id?: string | number; name?: string };
  /** THIS call's note strings, e.g. ["(516) 351-6036 -- Left Message."]. */
  call_notes?: string[];
  /** Dial-session events; shape unconfirmed beyond null (no email example captured yet). */
  events?: { last_event?: unknown; next_event?: unknown };
  // Allow extra fields without flagging — PB sends a lot we don't use.
  [k: string]: unknown;
}

import { FOLDERS } from "@/lib/phoneburner/folders";

/** Legacy write prefix (pre-2026-07-21). Kept ONLY for guard back-compat. */
const POCOMOS_NOTE_PREFIX = "📞 PhoneBurner Call —";

/**
 * Loop-guard matcher for PB-originated Pocomos notes (2026-07-21 redesign).
 *
 * ⚠️ Pocomos STRIPS the 📞 emoji and stores a literal "?" (verified on the
 * live notes 2026-07-21), so the old exact-prefix test `startsWith("📞
 * PhoneBurner Call —")` NEVER matched what Pocomos actually returns — the
 * read-back filter was silently broken. The guard is now an emoji-free regex
 * matching the NEW campaign-style first line ("Wellness call — X" / "Lead
 * call — X" / "Win-back call — X" / "PhoneBurner call — X") AND every stored
 * form of the legacy prefix ("📞 PhoneBurner Call —" as written, "? PhoneBurner
 * Call —" as Pocomos stores it, bare "PhoneBurner Call —"). The em-dash
 * survives the Pocomos round-trip (verified), but "-"/"–" are tolerated too.
 */
export const PB_NOTE_GUARD = /^(?:📞\s*|\?\s*)?(?:wellness|lead|win-?back|phoneburner)\s+call\s*[—–-]/i;

/** True when a Pocomos note summary originated from a PhoneBurner call write. */
export function isPbOriginatedNote(summary: string | null | undefined): boolean {
  return PB_NOTE_GUARD.test((summary ?? "").trim());
}

/**
 * Campaign label for the note's first line, derived from the folder the dial
 * session ran from: wellness folders → "Wellness", lead folders → "Lead",
 * cancelled buckets → "Win-back", anything else/unknown → "PhoneBurner".
 */
export function campaignForFolder(folderId: string | number | null | undefined): string {
  const id = folderId != null ? String(folderId) : "";
  if (id === FOLDERS.WELLNESS_QUEUE || id === FOLDERS.WELLNESS_CALLED) return "Wellness";
  if (
    id === FOLDERS.LEADS_FRESH ||
    id === FOLDERS.LEADS_GENERAL ||
    id === FOLDERS.LEADS_COMPETITOR ||
    id === FOLDERS.LEADS_FINANCIAL ||
    id === FOLDERS.FOLLOW_UP
  ) {
    return "Lead";
  }
  if (
    id === FOLDERS.CANCELLED_COMPETITOR ||
    id === FOLDERS.CANCELLED_FINANCIAL ||
    id === FOLDERS.CANCELLED_RESULTS ||
    id === FOLDERS.CANCELLED_NO_REACH ||
    id === FOLDERS.CANCELLED_PERSONAL
  ) {
    return "Win-back";
  }
  return "PhoneBurner";
}

export interface ParsedWebhook {
  pbContactId: string;
  pocomosId: string;
  disposition: string;
  duration: string;
  csrName: string;
  /** Campaign label from the dialed folder ("Wellness"/"Lead"/"Win-back"/"PhoneBurner"). */
  campaign: string;
  /** One-touch email name/subject when detectable; "" = email detected but unnamed; null = none. */
  emailSent: string | null;
  /** Kept for telemetry only — NOT written to notes (all payload recording URLs 404, 2026-07-21). */
  recordingUrl: string;
  /** The most recent entry's body, after stripping PB's date/phone prefix. Empty when no real note. */
  noteBody: string;
  /** True when the parsed body is just PB auto-text re-stating the disposition. */
  noteIsAutoDisposition: boolean;
  /** The fully-rendered Pocomos `summary` string this webhook should write, or empty when loop-guarded. */
  pocomosSummary: string;
  /** True when we should NOT write to Pocomos (e.g. Customer ID missing, loop guard tripped). */
  skipReason: string | null;
}

/** PhoneBurner stamps `(NNN) NNN-NNNN -- ` between the date and the body when calling a contact. Strip it. */
const PHONE_PREFIX = /^\(?\d{3}\)?\s*\d{3}-?\d{4}\s*--\s*/;

/**
 * Each entry in `contact.notes` looks like:
 *   "-- 08/17/2021 @ 10:59 AM EDT -- (615) 265-0077 -- Voicemail Apt Setters sent."
 *   "-- 07/21/2026 @ 8:52 AM EDT by Ohavia Feldman -- Email sent: Are we living up…"
 * Sometimes timezone is present, sometimes the phone segment is present, and the
 * CURRENT wire format inserts "by {agent name}" before the closing "--" (found
 * 2026-07-21 — the old regex didn't consume it, so entry parsing silently
 * failed on every modern payload). The body is whatever follows the closing
 * `-- ` after the date/time[/author] header.
 */
const ENTRY_HEADER = /^--\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+@\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[A-Z]{0,4}\s*(?:by\s+[^\n]*?)?--\s*/i;

export interface NoteEntry {
  /** "MM/DD/YYYY" as printed. */
  date: string;
  /** Minutes-of-day (0-1439) parsed from the "h:mm AM/PM" header segment. */
  minutes: number;
  /** Entry body after the header + optional phone segment. */
  body: string;
}

/** Parse EVERY header-bearing entry out of a PB `notes` history string. */
export function parseNoteEntries(notesField: string | undefined | null): NoteEntry[] {
  if (!notesField) return [];
  const out: NoteEntry[] = [];
  for (const raw of notesField.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("--")) continue;
    const m = line.match(ENTRY_HEADER);
    if (!m) continue; // continuation line of a multi-line body
    let hours = parseInt(m[2], 10) % 12;
    if ((m[4] ?? "").toUpperCase() === "PM") hours += 12;
    out.push({
      date: m[1],
      minutes: hours * 60 + parseInt(m[3], 10),
      body: line.slice(m[0].length).replace(PHONE_PREFIX, "").trim(),
    });
  }
  return out;
}

export function parseLatestNoteEntry(notesField: string | undefined | null): {
  date: string;
  body: string;
} | null {
  const first = parseNoteEntries(notesField)[0];
  return first ? { date: first.date, body: first.body } : null;
}

/**
 * PB auto-prepends short disposition-y text to most call entries (e.g.
 * "No Answer.", "Voicemail Apt Setters sent."). When the parsed body is
 * basically a re-statement of the disposition, the CSR didn't actually
 * type a note and we should write `Notes: (none)` rather than duplicating.
 */
const PB_AUTO_PATTERNS = [
  /^voicemail(?:\s|$)/i,
  /^left\s*voicemail/i,
  /^vm(?:\s|left|$)/i,
  /^no\s*answer/i,
  /^busy/i,
  /^answered/i,
  /^hung\s*up/i,
  /^disconnected/i,
  /^not\s*interested/i,
  /^wrong\s*number/i,
  /^bad\s*number/i,
  // PB auto-logs one-touch sends as notes entries — never CSR-typed text.
  // (The send itself surfaces as the note's own "Email sent:" line instead.)
  /^email\s+sent/i,
];

export function isAutoDispositionNote(body: string, disposition: string): boolean {
  if (!body) return true;
  const trimmed = body.trim();
  if (!trimmed) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const b = norm(trimmed);
  const d = norm(disposition);
  if (d && b === d) return true;
  // Short bodies that just contain the disposition (with extra punctuation only).
  if (d && trimmed.length < 60 && b.includes(d)) return true;
  for (const p of PB_AUTO_PATTERNS) if (p.test(trimmed)) return true;
  return false;
}

export function extractCustomerId(payload: PBCallDonePayload): string {
  return extractCustomField(payload, "Customer ID");
}

/**
 * Read a named custom-field value from EVERY place PB is known to put them.
 *
 * ⚠️ On the real `api_calldone` wire (verified 2026-07-21 against stored
 * payloads), `typed_custom_fields` and the flat `custom_fields` object live at
 * the PAYLOAD TOP LEVEL — `contact.*` carries neither. The contact-level
 * variants are kept as fallbacks in case some PB event shape uses them.
 */
export function extractCustomField(payload: PBCallDonePayload, name: string): string {
  const typedLists = [payload.typed_custom_fields, payload.contact?.typed_custom_fields];
  for (const typed of typedLists) {
    if (!Array.isArray(typed)) continue;
    for (const f of typed) {
      if (f?.name === name && f.value != null && String(f.value).trim()) {
        return String(f.value).trim();
      }
    }
  }
  // PB sends custom_fields: false (boolean!) when a dial session has none.
  const flats = [payload.custom_fields, payload.contact?.custom_fields];
  for (const flat of flats) {
    if (!flat || typeof flat !== "object") continue;
    const v = (flat as Record<string, unknown>)[name];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * Wellness-campaign detection (2026-07-20; wire-corrected 2026-07-21): the call
 * belongs to the wellness queue when the payload's top-level `folder` (the
 * folder the dial session ran from) is the Wellness Queue, OR the contact's
 * category matches (fallback shape), OR the fields carry `Hub Source =
 * wellness` (the feeder stamps it on every push — covers hand-moved contacts).
 */
export function isWellnessContact(payload: PBCallDonePayload, queueFolderId: string): boolean {
  const folderId = payload.folder?.id;
  if (folderId != null && String(folderId) === queueFolderId) return true;
  const cat = payload.contact?.category?.category_id;
  if (cat != null && String(cat) === queueFolderId) return true;
  return extractCustomField(payload, "Hub Source").toLowerCase() === "wellness";
}

export function extractCsrName(payload: PBCallDonePayload): string {
  const a = payload.agent;
  if (!a) return "";
  if (a.name && a.name.trim()) return a.name.trim();
  return [a.first_name, a.last_name].filter((s) => s && s.trim()).join(" ").trim();
}

export function extractRecordingUrl(payload: PBCallDonePayload): string {
  return (payload.recording_url_public || payload.recording_url || "").trim();
}

export function extractDisposition(payload: PBCallDonePayload): string {
  return (payload.status || "").trim() || "Unknown";
}

export function extractDuration(payload: PBCallDonePayload): string {
  if (payload.duration == null) return "0";
  return String(payload.duration);
}

export function extractPbContactId(payload: PBCallDonePayload): string {
  const v = payload.contact?.user_id;
  return v != null ? String(v) : "";
}

/** Same-call tolerance for the email timestamp guard, in minutes. */
const EMAIL_CLUSTER_TOLERANCE_MIN = 3;

const EMAIL_SENT_PATTERNS = [
  /email\s+sent\s*[:—–-]?\s*(.*)$/i,
  /sent\s+(?:the\s+)?(?:one-?touch\s+)?email\s*[:—–-]?\s*(.*)$/i,
];

/**
 * Detect a one-touch email sent WITH THIS CALL's disposition (proven against
 * live payloads 2026-07-21): PB records it as a contact-notes entry — "-- {ts}
 * by {agent} -- Email sent: {subject}" — timestamped at the call, INSIDE the
 * same `api_calldone` payload (`contact.notes`), NOT in `events.last_event` /
 * `call_notes`.
 *
 * TIMESTAMP GUARD: an "Email sent" entry from a PREVIOUS call stays in the
 * history forever (verified: Ohavia's 10:01 re-dial payload still carries her
 * 8:52 email entry), so only entries in the NEWEST same-day entry cluster
 * (within EMAIL_CLUSTER_TOLERANCE_MIN of the newest entry's header time) count.
 * Header times are compared to each other — never to `start_time`/`end_time`,
 * which PB stamps in a DIFFERENT timezone (CT) than the note headers (ET).
 *
 * Returns the subject ("" when an email is detected but unnamed), or null when
 * no same-call email evidence exists — the note line is skipped then.
 */
export function extractEmailSent(payload: PBCallDonePayload): string | null {
  const entries = parseNoteEntries(payload.contact?.notes);
  if (entries.length) {
    const newest = entries.reduce((a, b) => {
      const [am, ad] = [a.minutes, Date.parse(a.date)];
      const [bm, bd] = [b.minutes, Date.parse(b.date)];
      return bd > ad || (bd === ad && bm > am) ? b : a;
    });
    for (const e of entries) {
      if (e.date !== newest.date) continue;
      if (newest.minutes - e.minutes > EMAIL_CLUSTER_TOLERANCE_MIN) continue;
      for (const p of EMAIL_SENT_PATTERNS) {
        const m = e.body.match(p);
        if (m) return (m[1] ?? "").trim();
      }
    }
  }
  // Secondary: this-call note strings (no email example seen here yet, kept cheap).
  if (Array.isArray(payload.call_notes)) {
    for (const raw of payload.call_notes) {
      if (typeof raw !== "string") continue;
      const line = raw.replace(PHONE_PREFIX, "").trim();
      for (const p of EMAIL_SENT_PATTERNS) {
        const m = line.match(p);
        if (m) return (m[1] ?? "").trim();
      }
    }
  }
  return null;
}

/**
 * Build the Pocomos `summary` string from a parsed payload — the SIMPLE format
 * (ops redesign 2026-07-21):
 *
 *   {Campaign} call — {disposition}
 *   Email sent: {name}          ← only when an email went out with the disposition
 *   {CSR} · {duration}s
 *   Notes: {text}               ← only when the CSR actually typed something
 *
 * NO recording line: every recording URL in the captured payloads (short
 * private AND long "public" form) 404s even when fetched intact, and the long
 * form additionally wraps/breaks in the Pocomos note display — the recording
 * lives in PB call history when it exists. "Notes: (none)" is gone by design.
 *
 * The first line IS the loop guard (`PB_NOTE_GUARD` / `isPbOriginatedNote`) —
 * emoji-free on purpose, because Pocomos stores 📞 as "?". Change it only
 * together with the guard.
 */
export function buildPocomosSummary(input: {
  campaign?: string;
  disposition: string;
  duration: string;
  csrName: string;
  noteBody: string;
  emailSent?: string | null;
}): string {
  const csr = input.csrName || "(unknown)";
  const lines = [`${input.campaign || "PhoneBurner"} call — ${input.disposition}`];
  if (input.emailSent != null) {
    lines.push(input.emailSent ? `Email sent: ${input.emailSent}` : "Email sent");
  }
  lines.push(`${csr} · ${input.duration}s`);
  if (input.noteBody && input.noteBody.trim()) {
    lines.push(`Notes: ${input.noteBody.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Top-level parse: turn a raw PB payload into a `ParsedWebhook` ready
 * for the route to persist + write. Implements both loop guards (see
 * §5.4) and the auto-disposition-vs-real-note heuristic.
 */
export function parseWebhook(payload: PBCallDonePayload): ParsedWebhook {
  const pbContactId = extractPbContactId(payload);
  const pocomosId = extractCustomerId(payload);
  const disposition = extractDisposition(payload);
  const duration = extractDuration(payload);
  const csrName = extractCsrName(payload);
  const recordingUrl = extractRecordingUrl(payload);
  const campaign = campaignForFolder(payload.folder?.id ?? payload.contact?.category?.category_id);
  const emailSent = extractEmailSent(payload);

  const latest = parseLatestNoteEntry(payload.contact?.notes);
  const rawBody = latest?.body ?? "";
  // Auto text and our OWN round-tripped notes (feeder blurbs / prior call
  // notes start with a campaign-call guard line) are never CSR-typed.
  const isAuto = isAutoDispositionNote(rawBody, disposition) || isPbOriginatedNote(rawBody);
  const noteBody = isAuto ? "" : rawBody;

  // Loop guard A: skip when the latest entry was itself a Pocomos note we already wrote.
  // (We push Pocomos→PB notes prefixed with "[Pocomos]" — see §5.4.)
  const loopGuardTripped = rawBody.trim().startsWith("[Pocomos]");

  let skipReason: string | null = null;
  if (loopGuardTripped) skipReason = "loop guard: latest contact.notes entry started with [Pocomos]";
  else if (!pocomosId) skipReason = "no Customer ID in payload custom fields";

  const pocomosSummary = skipReason
    ? ""
    : buildPocomosSummary({ campaign, disposition, duration, csrName, noteBody, emailSent });

  return {
    pbContactId,
    pocomosId,
    disposition,
    duration,
    csrName,
    campaign,
    emailSent,
    recordingUrl,
    noteBody,
    noteIsAutoDisposition: isAuto,
    pocomosSummary,
    skipReason,
  };
}

export { POCOMOS_NOTE_PREFIX };
