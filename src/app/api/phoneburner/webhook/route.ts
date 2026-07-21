import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { sql, initSchema } from "@/lib/db";
import { postJson, pocomosOffice } from "@/lib/pocomos";
import { getSessionedHtml } from "@/lib/pocomos/webSession";
import { POCOMOS_CALL_INTERACTION_TYPE } from "@/lib/pocomos/interactionTypes";
import {
  buildPocomosSummary,
  campaignForFolder,
  isWellnessContact,
  parseWebhook,
  type PBCallDonePayload,
  type ParsedWebhook,
} from "@/lib/sync/webhookProcessor";
import { updateContact, normalizePhone } from "@/lib/phoneburner/client";
import { WELLNESS_QUEUE_FOLDER, WELLNESS_CALLED_FOLDER } from "@/lib/phoneburner/folders";
import { CURRENT_YEAR } from "@/lib/pocomos/categorize";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface FindCustomerResponse {
  results?: Array<{ id?: string | number; external_account_id?: string }>;
}

interface TrackedRow {
  pocomos_id: string;
  pocomos_type: "lead" | "customer";
  folder_id: string;
}

async function lookupTrackedContact(pbContactId: string): Promise<TrackedRow | null> {
  if (!pbContactId) return null;
  const rows = (await sql`
    SELECT pocomos_id, pocomos_type, folder_id
      FROM phoneburner_contacts
     WHERE pb_contact_id = ${pbContactId}
     LIMIT 1
  `) as TrackedRow[];
  return rows[0] || null;
}

async function resolveCustomerUrlId(customerId: string): Promise<string | null> {
  // ⚠️ find-customer-by-office is a WEB-SESSION endpoint, NOT JWT (found
  // 2026-07-21 during the notes backfill): the JWT client gets a 200
  // login-redirect JSON ({"type":"redirect"}) with no results, so every
  // resolve silently failed. Use the sessioned web client. No &active=1 —
  // win-back dials resolve INACTIVE customers by design.
  try {
    const body = await getSessionedHtml(
      `/customer/find-customer-by-office?suggest=${encodeURIComponent(customerId)}`
    );
    const resp = JSON.parse(body) as FindCustomerResponse;
    const first = resp.results?.[0];
    return first?.id != null ? String(first.id) : null;
  } catch {
    return null;
  }
}

async function writeCustomerNote(urlId: string, summary: string, subject?: string): Promise<void> {
  await postJson(`/jwt/pronexis/${pocomosOffice()}/customer/${urlId}/note/create`, {
    note: {
      interactionType: POCOMOS_CALL_INTERACTION_TYPE,
      summary,
      ...(subject ? { subject } : {}),
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

/**
 * Wellness-campaign fall-out (2026-07-20, REFERENCE §5.21). A dial attempt of
 * ANY disposition — connected, VM, No Answer — removes the customer from the
 * queue for the rest of the season:
 *
 *   1. Insert the `wellness_calls` row FIRST — it IS the season re-entry guard.
 *      If the PB move below fails, the guard still holds (the daily feeder
 *      reconciles the folder); a re-fired webhook hits the PK and no-ops.
 *   2. Move the PB contact to Wellness — Called (form-urlencoded PUT) and
 *      re-point the phoneburner_contacts cache row.
 *   3. Write the Pocomos note DIRECTLY: for wellness contacts the stored
 *      Customer ID is the INTERNAL url_id (that's what the feeder stamps), so
 *      the find-customer-by-office resolve step is skipped.
 *
 * The note is written even when the parser's loop guard blanked the note body —
 * the CALL still happened (api_calldone fired); only the body is suppressed.
 */
async function processWellnessCall(parsed: ParsedWebhook, raw: unknown): Promise<void> {
  const errors: string[] = [];

  // 1. Season guard row — FIRST, before any external write.
  let guardInserted = false;
  try {
    const rows = (await sql`
      INSERT INTO wellness_calls (pocomos_id, season, disposition, csr_name, pb_contact_id)
      VALUES (${parsed.pocomosId}, ${Number(CURRENT_YEAR)}, ${parsed.disposition || null},
              ${parsed.csrName || null}, ${parsed.pbContactId || null})
      ON CONFLICT (pocomos_id, season) DO NOTHING
      RETURNING pocomos_id
    `) as Array<{ pocomos_id: string }>;
    guardInserted = rows.length > 0;
  } catch (e) {
    errors.push(`wellness_calls insert: ${(e as Error).message}`);
  }

  // 2. PB folder move Queue → Called + cache re-point.
  try {
    if (parsed.pbContactId) {
      await updateContact(parsed.pbContactId, { category_id: WELLNESS_CALLED_FOLDER });
      await sql`
        UPDATE phoneburner_contacts
           SET folder_id = ${WELLNESS_CALLED_FOLDER}, last_updated_at = NOW()
         WHERE pb_contact_id = ${parsed.pbContactId}
      `;
    }
  } catch (e) {
    errors.push(`PB move to Called: ${(e as Error).message}`);
  }

  // 3. Pocomos note — direct write, the stored Customer ID IS the url_id.
  //    Repeat webhooks (guard already present) still log the call as a note:
  //    full call history on the account is the existing §5.4 behavior.
  let noteWritten = false;
  try {
    // Rebuild unconditionally with the Wellness campaign label — the parser's
    // folder-derived label can miss (payload without `folder`), and the
    // loop-guard case leaves pocomosSummary empty while the call still counts.
    const summary = buildPocomosSummary({
      campaign: "Wellness",
      disposition: parsed.disposition,
      duration: parsed.duration,
      csrName: parsed.csrName,
      noteBody: parsed.noteBody,
      emailSent: parsed.emailSent,
    });
    await writeCustomerNote(parsed.pocomosId, summary, "Wellness Call");
    noteWritten = true;
  } catch (e) {
    errors.push(`Pocomos note: ${(e as Error).message}`);
  }

  console.log(
    JSON.stringify({
      event: "webhook.wellness",
      pocomos_id: parsed.pocomosId,
      pb_contact_id: parsed.pbContactId,
      disposition: parsed.disposition,
      guard_inserted: guardInserted,
      note_written: noteWritten,
      errors: errors.length ? errors : undefined,
    })
  );
  await logWebhook({
    parsed,
    noteWritten,
    error: errors.length ? `wellness: ${errors.join(" | ")}` : null,
    raw,
  });
}

async function processNoteWrite(payload: PBCallDonePayload): Promise<void> {
  await initSchema();
  const parsed = parseWebhook(payload);

  // REPLAY / RETRY GATE (2026-07-21): a webhook_log row with the same PB
  // call_id that ALREADY wrote a note means this event was fully processed —
  // a replay (manual or PB retry) must never double-write the Pocomos note
  // (found live: Rivka's record got the same call twice). Hard skip: the
  // wellness guard/move are idempotent anyway, so nothing else is lost.
  const callId = payload.call_id != null ? String(payload.call_id) : "";
  if (callId) {
    const dup = (await sql`
      SELECT 1 FROM webhook_log
       WHERE raw_payload->>'call_id' = ${callId} AND note_written = TRUE
       LIMIT 1
    `) as unknown[];
    if (dup.length) {
      console.warn(
        JSON.stringify({ event: "webhook.duplicate_call", call_id: callId, pb_contact_id: parsed.pbContactId })
      );
      await logWebhook({
        parsed,
        noteWritten: false,
        error: `duplicate call_id ${callId} — note already written (replay guard)`,
        raw: payload,
      });
      return;
    }
  }

  const tracked = await lookupTrackedContact(parsed.pbContactId);

  // DB-bridge fallback (2026-07-21): if the payload carried no Customer ID
  // (fields missing/renamed — PB's wire shape has drifted before), resolve it
  // from our own phoneburner_contacts cache via the PB contact id. This is the
  // bridge rev 20 identified; it makes the note flow resilient to payload
  // shape changes instead of silently skipping.
  // Our cache stores INTERNAL customer ids (url_ids), so a bridged customer id
  // skips the find-customer-by-office resolve (that endpoint takes the
  // EXTERNAL number, which is what PB custom fields on legacy contacts hold).
  let idIsInternal = false;
  if (!parsed.pocomosId && tracked) {
    parsed.pocomosId = tracked.pocomos_id;
    idIsInternal = tracked.pocomos_type === "customer";
    if (parsed.skipReason?.startsWith("no Customer ID")) {
      parsed.skipReason = null;
      parsed.pocomosSummary = buildPocomosSummary({
        // Payload had no folder either (or we'd have a campaign match) — derive
        // the campaign from the folder OUR cache last saw the contact in.
        campaign: campaignForFolder(tracked.folder_id),
        disposition: parsed.disposition,
        duration: parsed.duration,
        csrName: parsed.csrName,
        noteBody: parsed.noteBody,
        emailSent: parsed.emailSent,
      });
    }
  }

  // Wellness-campaign fall-out: a dial from the Queue folder (payload-level
  // `folder`), a Queue-category contact, a Hub Source=wellness field, OR our
  // own cache row saying the contact lives in the Queue — any of these makes
  // it a wellness call, regardless of disposition. Requires a Customer ID;
  // without one there is nothing to guard or write against, so fall through
  // to the normal skip logging below.
  const wellness =
    isWellnessContact(payload, WELLNESS_QUEUE_FOLDER) ||
    tracked?.folder_id === WELLNESS_QUEUE_FOLDER;
  if (parsed.pocomosId && wellness) {
    await processWellnessCall(parsed, payload);
    return;
  }

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

  const isLead = tracked?.pocomos_type === "lead";

  let noteWritten = false;
  let error: string | null = null;

  try {
    if (isLead) {
      await writeLeadNote(parsed.pocomosId, parsed.pocomosSummary);
      noteWritten = true;
    } else if (idIsInternal) {
      // Bridged from phoneburner_contacts — already the internal url_id.
      await writeCustomerNote(parsed.pocomosId, parsed.pocomosSummary);
      noteWritten = true;
    } else {
      let urlId = await resolveCustomerUrlId(parsed.pocomosId);
      if (!urlId) {
        // find-customer-by-office can't see CANCELLED customers (proven on the
        // rev-54 backfill — every win-back id came back empty), so fall back to
        // the enriched `customers` Neon table by phone + last name (the sweep's
        // identity rule). Win-back dials are exactly this population.
        const digits = normalizePhone(String(payload.contact?.phone ?? ""));
        const last = String(payload.contact?.last_name ?? "").trim();
        if (digits.length === 10 && last) {
          const cands = (await sql`
            SELECT pocomos_id, phone FROM customers WHERE LOWER(last_name) = ${last.toLowerCase()}
          `) as Array<{ pocomos_id: string; phone: string | null }>;
          const hit = cands.find((c) => normalizePhone(c.phone ?? "") === digits);
          if (hit) urlId = String(hit.pocomos_id);
        }
      }
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
