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
  // Allow extra fields without flagging — PB sends a lot we don't use.
  [k: string]: unknown;
}

const POCOMOS_NOTE_PREFIX = "📞 PhoneBurner Call —";

export interface ParsedWebhook {
  pbContactId: string;
  pocomosId: string;
  disposition: string;
  duration: string;
  csrName: string;
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
 *   "-- 03/19/2021 @ 11:52 AM -- Email sent: (615) 265-0077, no one answered..."
 * Sometimes timezone is present, sometimes the phone segment is present, sometimes not.
 * The body is whatever follows the last `-- ` after the date/time header.
 */
const ENTRY_HEADER = /^--\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+@\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[A-Z]{0,4}\s*--\s*/i;

export function parseLatestNoteEntry(notesField: string | undefined | null): {
  date: string;
  body: string;
} | null {
  if (!notesField) return null;
  // Entries are newline-separated. Find the first one that starts with "--".
  const lines = notesField.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("--")) continue;
    const m = line.match(ENTRY_HEADER);
    if (!m) {
      // Falls through to next line — this one looks like a continuation.
      continue;
    }
    const date = m[1];
    const tail = line.slice(m[0].length).replace(PHONE_PREFIX, "").trim();
    return { date, body: tail };
  }
  return null;
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

/**
 * Build the Pocomos `summary` string from a parsed payload. Format is the
 * one mandated by §5.4 of REFERENCE.md and is the prefix-loop-guard the
 * Pocomos→PhoneBurner direction looks for ("📞 PhoneBurner Call —"), so
 * don't change the leading line casually.
 */
export function buildPocomosSummary(input: {
  disposition: string;
  duration: string;
  csrName: string;
  noteBody: string;
  recordingUrl: string;
}): string {
  const csr = input.csrName || "(unknown)";
  const noteText = input.noteBody && input.noteBody.trim() ? input.noteBody.trim() : "(none)";
  const recording = input.recordingUrl || "(none)";
  return [
    `${POCOMOS_NOTE_PREFIX} ${input.disposition}`,
    `Duration: ${input.duration}s · CSR: ${csr}`,
    `Notes: ${noteText}`,
    `Recording: ${recording}`,
  ].join("\n");
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

  const latest = parseLatestNoteEntry(payload.contact?.notes);
  const rawBody = latest?.body ?? "";
  const isAuto = isAutoDispositionNote(rawBody, disposition);
  const noteBody = isAuto ? "" : rawBody;

  // Loop guard A: skip when the latest entry was itself a Pocomos note we already wrote.
  // (We push Pocomos→PB notes prefixed with "[Pocomos]" — see §5.4.)
  const loopGuardTripped = rawBody.trim().startsWith("[Pocomos]");

  let skipReason: string | null = null;
  if (loopGuardTripped) skipReason = "loop guard: latest contact.notes entry started with [Pocomos]";
  else if (!pocomosId) skipReason = "no Customer ID in payload custom fields";

  const pocomosSummary = skipReason
    ? ""
    : buildPocomosSummary({ disposition, duration, csrName, noteBody, recordingUrl });

  return {
    pbContactId,
    pocomosId,
    disposition,
    duration,
    csrName,
    recordingUrl,
    noteBody,
    noteIsAutoDisposition: isAuto,
    pocomosSummary,
    skipReason,
  };
}

export { POCOMOS_NOTE_PREFIX };
