import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sql, initSchema } from "@/lib/db";
import { getJson, postJson, pocomosOffice } from "@/lib/pocomos";
import { POCOMOS_CALL_INTERACTION_TYPE } from "@/lib/pocomos/interactionTypes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Resolves Vercel's `waitUntil` if the function runtime exposes it via
 * @vercel/functions; otherwise degrades to fire-and-forget. The fallback
 * works in local dev but on serverless the function may be killed before
 * the background promise settles — install @vercel/functions to fix.
 */
type WaitUntilFn = (p: Promise<unknown>) => void;
let cachedWaitUntil: WaitUntilFn | null = null;
async function resolveWaitUntil(): Promise<WaitUntilFn> {
  if (cachedWaitUntil) return cachedWaitUntil;
  try {
    // @ts-expect-error — @vercel/functions is optional; install it to get real waitUntil.
    const mod = (await import("@vercel/functions").catch(() => null)) as
      | { waitUntil?: WaitUntilFn }
      | null;
    if (mod?.waitUntil) {
      cachedWaitUntil = mod.waitUntil;
      return cachedWaitUntil;
    }
  } catch {
    /* fall through */
  }
  cachedWaitUntil = (p) => {
    p.catch((e) => console.error("webhook background task failed", e));
  };
  return cachedWaitUntil;
}

interface PBWebhookPayload {
  status?: string;
  disposition?: string;
  duration?: number | string;
  call_recording_url?: string;
  notes?: string;
  csr_name?: string;
  csr?: { name?: string; first_name?: string; last_name?: string };
  user?: { name?: string; first_name?: string; last_name?: string };
  contact?: {
    user_id?: string | number;
    custom_fields?: Array<{ name?: string; value?: string }>;
  };
}

interface FindCustomerResponse {
  results?: Array<{ id?: string | number; external_account_id?: string }>;
}

function pickDisposition(p: PBWebhookPayload): string {
  return p.status || p.disposition || "Unknown";
}

function pickCsrName(p: PBWebhookPayload): string {
  if (p.csr_name) return p.csr_name;
  const c = p.csr || p.user;
  if (!c) return "";
  if (c.name) return c.name;
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

function pickPocomosId(p: PBWebhookPayload): string {
  const fields = p.contact?.custom_fields || [];
  for (const f of fields) {
    if (f.name === "Customer ID" && f.value) return String(f.value);
  }
  return "";
}

function buildNoteSummary(p: PBWebhookPayload): string {
  const disposition = pickDisposition(p);
  const duration = p.duration != null ? String(p.duration) : "0";
  const csr = pickCsrName(p) || "(unknown)";
  const noteText = (p.notes || "").trim();
  const recording = (p.call_recording_url || "").trim();
  return [
    `📞 PhoneBurner Call — ${disposition}`,
    `Duration: ${duration}s · CSR: ${csr}`,
    `Notes: ${noteText || "(none)"}`,
    `Recording: ${recording || "(none)"}`,
  ].join("\n");
}

interface TrackedRow {
  pocomos_type: "lead" | "customer";
  folder_id: string;
}

async function lookupTrackedContact(pbContactId: string): Promise<TrackedRow | null> {
  const rows = (await sql`
    SELECT pocomos_type, folder_id
      FROM phoneburner_contacts
     WHERE pb_contact_id = ${pbContactId}
     LIMIT 1
  `) as TrackedRow[];
  return rows[0] || null;
}

async function resolveCustomerUrlId(customerId: string): Promise<string | null> {
  try {
    const resp = await getJson<FindCustomerResponse>(
      `/customer/find-customer-by-office?suggest=${encodeURIComponent(customerId)}&active=1`
    );
    const first = resp.results?.[0];
    return first?.id != null ? String(first.id) : null;
  } catch {
    return null;
  }
}

async function writeCustomerNote(urlId: string, summary: string): Promise<void> {
  await postJson(`/jwt/pronexis/${pocomosOffice()}/customer/${urlId}/note/create`, {
    note: {
      interactionType: POCOMOS_CALL_INTERACTION_TYPE,
      summary,
      displayOnWorkorder: false,
      favorite: false,
      displayOnLoad: false,
      displayOnRouteMap: false,
      showOnTechApp: false,
    },
  });
}

async function writeLeadNote(leadId: string, summary: string): Promise<void> {
  // Lead-note path is unverified (see §9). Try, swallow 404, surface anything else.
  try {
    await postJson(`/jwt/${pocomosOffice()}/lead/${leadId}/note`, { note: { summary } });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/failed:\s*404/.test(msg)) throw e;
    console.warn(JSON.stringify({ event: "webhook.lead_note.404", lead_id: leadId, error: msg }));
  }
}

async function logWebhook(args: {
  pocomosId: string;
  disposition: string;
  csrName: string;
  noteWritten: boolean;
  error: string | null;
  raw: unknown;
}): Promise<void> {
  await sql`
    INSERT INTO webhook_log (pocomos_id, disposition, csr_name, note_written, error, raw_payload)
    VALUES (
      ${args.pocomosId || null},
      ${args.disposition || null},
      ${args.csrName || null},
      ${args.noteWritten},
      ${args.error},
      ${JSON.stringify(args.raw)}::jsonb
    )
  `;
}

async function processNoteWrite(payload: PBWebhookPayload): Promise<void> {
  await initSchema();
  const pocomosId = pickPocomosId(payload);
  const summary = buildNoteSummary(payload);
  const disposition = pickDisposition(payload);
  const csrName = pickCsrName(payload);

  if (summary.startsWith("[Pocomos]")) {
    await logWebhook({
      pocomosId,
      disposition,
      csrName,
      noteWritten: false,
      error: "loop guard: summary started with [Pocomos]",
      raw: payload,
    });
    return;
  }

  if (!pocomosId) {
    console.warn(JSON.stringify({ event: "webhook.missing_customer_id", payload }));
    await logWebhook({
      pocomosId: "",
      disposition,
      csrName,
      noteWritten: false,
      error: "no Customer ID in custom_fields",
      raw: payload,
    });
    return;
  }

  const pbContactId = payload.contact?.user_id ? String(payload.contact.user_id) : "";
  const tracked = pbContactId ? await lookupTrackedContact(pbContactId) : null;

  // pocomos_type from the tracking row tells us lead vs customer. When the
  // contact isn't in the tracking table (manual upload, etc.) we default to
  // customer since that's the dominant case for dialer activity.
  const isLead = tracked?.pocomos_type === "lead";

  let noteWritten = false;
  let error: string | null = null;

  try {
    if (isLead) {
      await writeLeadNote(pocomosId, summary);
      noteWritten = true;
    } else {
      const urlId = await resolveCustomerUrlId(pocomosId);
      if (!urlId) {
        error = `could not resolve URL ID for Customer ID ${pocomosId}`;
      } else {
        await writeCustomerNote(urlId, summary);
        noteWritten = true;
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }

  await logWebhook({
    pocomosId,
    disposition,
    csrName,
    noteWritten,
    error,
    raw: payload,
  });
}

/**
 * PhoneBurner `api_calldone` webhook handler.
 *
 *   POST /api/phoneburner/webhook?secret=$WEBHOOK_SECRET
 *
 * Returns 200 immediately and runs the Pocomos note write in the
 * background via waitUntil (with a fire-and-forget fallback when
 * @vercel/functions isn't available). PhoneBurner's webhook timeout
 * is ~3s — note writes can take longer than that, so the response
 * has to fly out before the work starts.
 */
export async function POST(request: Request) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) {
    const generated = crypto.randomBytes(32).toString("hex");
    const message =
      "WEBHOOK_SECRET is not set. Add it to Vercel env (Production + Preview):\n" +
      `  WEBHOOK_SECRET=${generated}\n` +
      "Then configure the PhoneBurner webhook URL with `?secret=` matching this value.";
    console.error(message);
    return NextResponse.json(
      { ok: false, error: "WEBHOOK_SECRET not set", setup_message: message },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: PBWebhookPayload;
  try {
    payload = (await request.json()) as PBWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const waitUntil = await resolveWaitUntil();
  waitUntil(
    processNoteWrite(payload).catch((e) =>
      console.error(JSON.stringify({ event: "webhook.processing.error", error: (e as Error).message }))
    )
  );

  return NextResponse.json({ ok: true, received_at: new Date().toISOString() });
}
