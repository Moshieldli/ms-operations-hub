import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { sql, initSchema } from "@/lib/db";
import { getJson, postJson, pocomosOffice } from "@/lib/pocomos";
import { POCOMOS_CALL_INTERACTION_TYPE } from "@/lib/pocomos/interactionTypes";
import {
  parseWebhook,
  type PBCallDonePayload,
  type ParsedWebhook,
} from "@/lib/sync/webhookProcessor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface FindCustomerResponse {
  results?: Array<{ id?: string | number; external_account_id?: string }>;
}

interface TrackedRow {
  pocomos_type: "lead" | "customer";
  folder_id: string;
}

async function lookupTrackedContact(pbContactId: string): Promise<TrackedRow | null> {
  if (!pbContactId) return null;
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
  parsed: ParsedWebhook;
  noteWritten: boolean;
  error: string | null;
  raw: unknown;
}): Promise<void> {
  await sql`
    INSERT INTO webhook_log (
      pocomos_id, pb_contact_id, disposition, csr_name,
      note_written, error, raw_payload
    ) VALUES (
      ${args.parsed.pocomosId || null},
      ${args.parsed.pbContactId || null},
      ${args.parsed.disposition || null},
      ${args.parsed.csrName || null},
      ${args.noteWritten},
      ${args.error},
      ${JSON.stringify(args.raw)}::jsonb
    )
  `;
}

async function processNoteWrite(payload: PBCallDonePayload): Promise<void> {
  await initSchema();
  const parsed = parseWebhook(payload);

  if (parsed.skipReason) {
    console.warn(
      JSON.stringify({
        event: "webhook.skipped",
        reason: parsed.skipReason,
        pb_contact_id: parsed.pbContactId,
        disposition: parsed.disposition,
      })
    );
    await logWebhook({ parsed, noteWritten: false, error: parsed.skipReason, raw: payload });
    return;
  }

  const tracked = await lookupTrackedContact(parsed.pbContactId);
  const isLead = tracked?.pocomos_type === "lead";

  let noteWritten = false;
  let error: string | null = null;

  try {
    if (isLead) {
      await writeLeadNote(parsed.pocomosId, parsed.pocomosSummary);
      noteWritten = true;
    } else {
      const urlId = await resolveCustomerUrlId(parsed.pocomosId);
      if (!urlId) {
        error = `could not resolve URL ID for Customer ID ${parsed.pocomosId}`;
      } else {
        await writeCustomerNote(urlId, parsed.pocomosSummary);
        noteWritten = true;
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }

  await logWebhook({ parsed, noteWritten, error, raw: payload });
}

/**
 * PhoneBurner `api_calldone` (Call End) webhook handler.
 *
 *   POST /api/phoneburner/webhook?secret=$WEBHOOK_SECRET
 *
 * Returns 200 immediately and runs the Pocomos note write in the
 * background via waitUntil. PhoneBurner's webhook timeout is ~3s — note
 * writes can take longer than that, so the response has to fly out
 * before the work starts.
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

  let payload: PBCallDonePayload;
  try {
    payload = (await request.json()) as PBCallDonePayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  waitUntil(
    processNoteWrite(payload).catch((e) =>
      console.error(JSON.stringify({ event: "webhook.processing.error", error: (e as Error).message }))
    )
  );

  return NextResponse.json({ ok: true, received_at: new Date().toISOString() });
}
