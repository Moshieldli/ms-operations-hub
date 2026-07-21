/**
 * Historical webhook-notes backfill (rev 54) — replay every webhook_log row
 * whose Pocomos note never wrote (the dead-parser era, §4 landmine) and write
 * the v2-format note with the ORIGINAL call date in the body.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-webhook-notes.ts [--live]
 *
 * RULES (ops spec 2026-07-21):
 *  1. NOTES ONLY — no PB writes, no folder moves, no wellness_calls inserts.
 *  2. Line 1 carries the real call date: "{Campaign} call — {disposition} · M/D/YY"
 *     (campaign from payload.folder → phoneburner_contacts.folder_id → "Phone").
 *  3. Dedupe = the live replay gate: any row whose call_id already has a
 *     note_written=TRUE row is skipped; each written row is flipped to TRUE.
 *  3b. SAFETY: abort if any selected row is from today (ET) or wellness-tagged.
 *  4. Unresolvable rows (no Customer ID + no DB-bridge row): count, skip, list.
 *  5. "Email sent:" line via the same live extraction (timestamp-guarded).
 *  6. Oldest-first; paced writes (Pocomos-gentle).
 */
import { sql, initSchema } from "../src/lib/db";
import { postJson, pocomosOffice } from "../src/lib/pocomos";
import { fetchAllCustomers } from "../src/lib/pocomos/customers";
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { normalizePhone } from "../src/lib/phoneburner/client";
import { POCOMOS_CALL_INTERACTION_TYPE } from "../src/lib/pocomos/interactionTypes";
import {
  parseWebhook,
  buildPocomosSummary,
  campaignForFolder,
  type PBCallDonePayload,
} from "../src/lib/sync/webhookProcessor";
import { WELLNESS_QUEUE_FOLDER, WELLNESS_CALLED_FOLDER } from "../src/lib/phoneburner/folders";

const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PB "Test Folder" — API-testing scratch space (see leadSync's dedupe note).
 *  Ops 2026-07-21: dials made FROM it are testing artifacts — excluded. */
const TEST_FOLDER_ID = "66224471";

interface LogRow {
  id: number;
  received_at: string; // ISO from Neon
  raw_payload: PBCallDonePayload;
}

interface TrackedRow {
  pocomos_id: string;
  pocomos_type: "lead" | "customer";
  folder_id: string;
}

/** received_at (UTC ISO) → "M/D/YY" in Eastern time. */
function etCallDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  }).format(d);
  return parts; // en-US numeric gives M/D/YY
}

function etIsToday(iso: string): boolean {
  const fmt = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  return fmt(new Date(iso)) === fmt(new Date());
}

/**
 * CALL-TIME wellness detection — payload dialed-folder + Hub Source field ONLY.
 * Deliberately NOT phoneburner_contacts.folder_id: that reflects TODAY's folder,
 * and the July fill moved many long-standing contacts into the wellness folders,
 * which falsely flagged their pre-campaign calls on the first dry run (verified:
 * all such rows were dialed from Test/Canc/Fresh/Active folders at call time).
 */
function isWellnessRow(payload: PBCallDonePayload): boolean {
  const f = payload.folder?.id != null ? String(payload.folder.id) : "";
  if (f === WELLNESS_QUEUE_FOLDER || f === WELLNESS_CALLED_FOLDER) return true;
  const s = JSON.stringify(payload.typed_custom_fields ?? "");
  return /"Hub Source"[^}]*"wellness"/i.test(s);
}

async function lookupTracked(pbContactId: string): Promise<TrackedRow | null> {
  if (!pbContactId) return null;
  const rows = (await sql`
    SELECT pocomos_id, pocomos_type, folder_id FROM phoneburner_contacts
    WHERE pb_contact_id = ${pbContactId} LIMIT 1
  `) as unknown as TrackedRow[];
  return rows[0] ?? null;
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

/** Lead-note path (unverified in Pocomos docs; 404 is swallowed + reported). */
async function writeLeadNote(leadId: string, summary: string): Promise<"written" | "404"> {
  try {
    await postJson(`/jwt/${pocomosOffice()}/lead/${leadId}/note`, { note: { summary } });
    return "written";
  } catch (e) {
    if (/failed:\s*404/.test((e as Error).message)) return "404";
    throw e;
  }
}

interface FindCustomerResponse {
  results?: Array<{ id?: string | number }>;
}

interface BridgeHit {
  id: string;
  how: "email" | "phone";
}

(async () => {
  const live = process.argv.includes("--live");
  await initSchema();

  // ---- Contact-details bridge (found on live attempt #2): the
  //      find-customer-by-office endpoint returns EMPTY for cancelled
  //      customers no matter the params, and the win-back folder is nothing
  //      but cancelled customers. Neither does any bulk source expose the
  //      external number (re-confirmed: customer_number empty on all 3,846
  //      JWT records). So external id → internal id goes through CONTACT
  //      DETAILS, the same email → phone+last-name laddering as
  //      conversionSweep/idMap. One bulk JWT pull, all statuses. ----
  const allCustomers = (await fetchAllCustomers()) as Array<Record<string, unknown>>;
  const byEmail = new Map<string, Array<{ id: string; last: string }>>();
  const byPhone = new Map<string, Array<{ id: string; last: string }>>();
  for (const c of allCustomers) {
    const id = String(c.id);
    const last = String(c.lastName ?? "").toLowerCase().trim();
    const em = String(c.emailAddress ?? "").toLowerCase().trim();
    if (em) byEmail.set(em, [...(byEmail.get(em) ?? []), { id, last }]);
    const ph = normalizePhone(String(c.phone ?? ""));
    if (ph.length === 10) byPhone.set(ph, [...(byPhone.get(ph) ?? []), { id, last }]);
  }
  console.log(`bridge loaded: ${allCustomers.length} customers · ${byEmail.size} emails · ${byPhone.size} phones`);

  function bridge(payload: PBCallDonePayload): BridgeHit | null {
    const c = (payload.contact ?? {}) as Record<string, unknown>;
    const last = String(c.last_name ?? "").toLowerCase().trim();
    const em = String(
      c.primary_email ?? (Array.isArray(c.emails) ? c.emails[0] : "") ?? ""
    ).toLowerCase().trim();
    if (em && byEmail.has(em)) {
      const cands = byEmail.get(em)!;
      const named = cands.filter((x) => last && x.last === last);
      if (named.length) return { id: named[0].id, how: "email" };
      if (cands.length === 1) return { id: cands[0].id, how: "email" };
    }
    const ph = normalizePhone(String(c.phone ?? ""));
    if (ph.length === 10 && byPhone.has(ph)) {
      // Phone alone isn't identity (spouses/relatives share numbers — the
      // sweep's rule); require the last name to agree.
      const named = byPhone.get(ph)!.filter((x) => last && x.last === last);
      if (named.length) return { id: named[0].id, how: "phone" };
    }
    return null;
  }

  // ---- Selection: dead-parser era rows, oldest first. ----
  const rows = (await sql`
    SELECT id, received_at, raw_payload FROM webhook_log
    WHERE note_written = FALSE
      AND received_at >= '2026-05-01'
      AND (error IS NULL OR error NOT LIKE 'duplicate call_id%')
    ORDER BY received_at ASC
  `) as unknown as LogRow[];

  // Call-ids that already produced a note (the live gate's condition).
  const writtenCallIds = new Set(
    (
      (await sql`
        SELECT DISTINCT raw_payload->>'call_id' AS cid FROM webhook_log
        WHERE note_written = TRUE AND raw_payload->>'call_id' IS NOT NULL
      `) as Array<{ cid: string }>
    ).map((r) => r.cid)
  );

  type Item = {
    logId: number;
    receivedAt: string;
    callDate: string;
    campaign: string;
    summary: string;
    target: { kind: "customer-internal" | "customer-resolve" | "lead"; id: string };
    emailSent: string | null;
  };
  const items: Item[] = [];
  const skippedGate: number[] = [];
  const excludedTest: number[] = [];
  const bridgedBy = { email: 0, phone: 0 };
  const unresolvable: Array<{ logId: number; receivedAt: string; pbContactId: string; reason: string }> = [];
  let wellnessInSet = 0;
  let todayInSet = 0;
  const seenCallIds = new Set<string>();

  for (const row of rows) {
    const payload = row.raw_payload;
    const callId = payload.call_id != null ? String(payload.call_id) : "";

    // Gate (req 3): already written (incl. the processed test calls), or a
    // duplicate call_id earlier in this same backfill set.
    if (callId && (writtenCallIds.has(callId) || seenCallIds.has(callId))) {
      skippedGate.push(row.id);
      continue;
    }
    if (callId) seenCallIds.add(callId);

    // Ops exclusion: calls dialed from the Test Folder are testing artifacts.
    if (payload.folder?.id != null && String(payload.folder.id) === TEST_FOLDER_ID) {
      excludedTest.push(row.id);
      continue;
    }

    const parsed = parseWebhook(payload);
    const tracked = await lookupTracked(parsed.pbContactId);

    // Safety accounting (req 3b) — counted BEFORE any exclusion decision.
    if (isWellnessRow(payload)) wellnessInSet++;
    if (etIsToday(row.received_at)) todayInSet++;

    // Resolution (req 4): tracked row → contact-details bridge → the
    // find-customer endpoint as a last resort (active customers only).
    let target: Item["target"] | null = null;
    if (tracked?.pocomos_type === "lead") {
      target = { kind: "lead", id: parsed.pocomosId || tracked.pocomos_id };
    } else if (tracked?.pocomos_type === "customer") {
      target = { kind: "customer-internal", id: tracked.pocomos_id };
    } else {
      const hit = bridge(payload);
      if (hit) {
        bridgedBy[hit.how]++;
        target = { kind: "customer-internal", id: hit.id };
      } else if (parsed.pocomosId) {
        target = { kind: "customer-resolve", id: parsed.pocomosId };
      }
    }
    if (!target) {
      unresolvable.push({
        logId: row.id,
        receivedAt: row.received_at,
        pbContactId: parsed.pbContactId || "(none)",
        reason: "no Customer ID in payload and no phoneburner_contacts row",
      });
      continue;
    }

    const campaign = campaignForFolder(payload.folder?.id ?? tracked?.folder_id) === "PhoneBurner" && !payload.folder?.id && !tracked?.folder_id
      ? "Phone"
      : campaignForFolder(payload.folder?.id ?? tracked?.folder_id);
    const callDate = etCallDate(row.received_at);
    const summary = buildPocomosSummary({
      campaign,
      disposition: parsed.disposition,
      duration: parsed.duration,
      csrName: parsed.csrName,
      noteBody: parsed.noteBody,
      emailSent: parsed.emailSent,
      callDate,
    });
    items.push({
      logId: row.id,
      receivedAt: row.received_at,
      callDate,
      campaign,
      summary,
      target,
      emailSent: parsed.emailSent,
    });
  }

  // ---- Report ----
  console.log(`\n================ WEBHOOK-NOTES BACKFILL ${live ? "LIVE" : "DRY RUN"} ================`);
  console.log(`candidate rows (note_written=FALSE since May): ${rows.length}`);
  console.log(`gate-skipped (call_id already wrote a note):   ${skippedGate.length}  [ids: ${skippedGate.join(", ") || "-"}]`);
  console.log(`excluded (Test Folder dials, ops):             ${excludedTest.length}  [ids: ${excludedTest.join(", ") || "-"}]`);
  console.log(`unresolvable (skipped, listed below):          ${unresolvable.length}`);
  console.log(`TO BACKFILL:                                   ${items.length}`);
  const byKind: Record<string, number> = {};
  const byCampaign: Record<string, number> = {};
  let withEmail = 0;
  for (const it of items) {
    byKind[it.target.kind] = (byKind[it.target.kind] ?? 0) + 1;
    byCampaign[it.campaign] = (byCampaign[it.campaign] ?? 0) + 1;
    if (it.emailSent != null) withEmail++;
  }
  console.log(`  by write path: ${JSON.stringify(byKind)}`);
  console.log(`  bridged: ${bridgedBy.email} by email · ${bridgedBy.phone} by phone+lastname`);
  console.log(`  by campaign:   ${JSON.stringify(byCampaign)}`);
  console.log(`  with an "Email sent:" line: ${withEmail}`);

  console.log(`\n---- 3b SAFETY CHECK ----`);
  if (items.length) {
    console.log(`  date range of selected rows: ${items[0].callDate} (${items[0].receivedAt}) → ${items[items.length - 1].callDate} (${items[items.length - 1].receivedAt})`);
  }
  console.log(`  rows from TODAY (ET) in set:      ${todayInSet}`);
  console.log(`  wellness-campaign rows in set:    ${wellnessInSet}`);
  const safe = todayInSet === 0 && wellnessInSet === 0;
  console.log(`  SAFETY: ${safe ? "PASS — zero today/wellness rows selected" : "FAIL — ABORTING"}`);
  if (!safe) process.exit(1);

  if (unresolvable.length) {
    console.log(`\n---- unresolvable (skipped) ----`);
    for (const u of unresolvable) console.log(`  log ${u.logId}  ${u.receivedAt}  pb=${u.pbContactId}  ${u.reason}`);
  }

  // ---- Samples: earliest, most recent, first-with-email. ----
  const samples: Array<[string, Item | undefined]> = [
    ["earliest", items[0]],
    ["most recent", items[items.length - 1]],
    ["with email line", items.find((i) => i.emailSent != null)],
  ];
  console.log(`\n---- SAMPLE NOTES (exactly as they will appear) ----`);
  for (const [label, it] of samples) {
    if (!it) { console.log(`  (${label}: none in set)`); continue; }
    console.log(`  == ${label} — log ${it.logId}, ${it.receivedAt}, path ${it.target.kind} ==`);
    console.log(it.summary.split("\n").map((l) => `    | ${l}`).join("\n"));
  }

  if (!live) {
    console.log(`\nDRY RUN — no writes. Re-run with --live after approval.`);
    return;
  }

  // ---- LIVE: oldest-first, paced, notes only. ----
  let written = 0;
  let lead404 = 0;
  const errors: Array<{ logId: number; error: string }> = [];
  for (const it of items) {
    await sleep(PAUSE_MS);
    try {
      if (it.target.kind === "lead") {
        const res = await writeLeadNote(it.target.id, it.summary);
        if (res === "404") { lead404++; continue; } // path dead for this lead — do NOT flip the flag
      } else if (it.target.kind === "customer-internal") {
        await writeCustomerNote(it.target.id, it.summary);
      } else {
        // WEB-SESSION endpoint (JWT gets a login-redirect JSON — found on the
        // first live attempt: all 276 resolves failed). No &active=1: win-back
        // dials resolve INACTIVE customers by design.
        const raw = await getSessionedHtml(
          `/customer/find-customer-by-office?suggest=${encodeURIComponent(it.target.id)}`
        );
        const resp = JSON.parse(raw) as FindCustomerResponse;
        const urlId = resp.results?.[0]?.id;
        if (urlId == null) {
          errors.push({ logId: it.logId, error: `could not resolve Customer ID ${it.target.id}` });
          continue;
        }
        await writeCustomerNote(String(urlId), it.summary);
      }
      await sql`UPDATE webhook_log SET note_written = TRUE, error = 'backfilled (rev 54)' WHERE id = ${it.logId}`;
      written++;
      if (written % 25 === 0) console.log(`  …${written}/${items.length} written`);
    } catch (e) {
      errors.push({ logId: it.logId, error: (e as Error).message.slice(0, 160) });
    }
  }
  console.log(`\nLIVE RESULT: written ${written} · lead-path-404 ${lead404} · errors ${errors.length} / of ${items.length}`);
  for (const e of errors.slice(0, 20)) console.log(`  log ${e.logId}: ${e.error}`);
  console.log("DONE");
})();
