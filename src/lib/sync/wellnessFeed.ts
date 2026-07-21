import { sql, initSchema } from "@/lib/db";
import { getDataset } from "@/lib/pocomos/dataset";
import { CURRENT_YEAR } from "@/lib/pocomos/categorize";
import {
  createContact,
  listContactsInFolder,
  updateContact,
  normalizePhone,
} from "@/lib/phoneburner/client";
import {
  WELLNESS_QUEUE_FOLDER,
  WELLNESS_CALLED_FOLDER,
} from "@/lib/phoneburner/folders";

/**
 * Wellness-call feeder (2026-07-20, REFERENCE §5.21) — the self-refilling
 * PhoneBurner queue of active customers with 2+ completed mosquito sprays this
 * season. Daily cron (07:00, after the 06:00 mosquito refresh so
 * `sprays_this_season` is fresh); new qualifiers flow in automatically as they
 * hit their 2nd spray.
 *
 * ELIGIBILITY (all must hold):
 *   1. Active per the dashboard definition — status `Active` AND >=1
 *      "{CURRENT_YEAR} -" tag, from getDataset() (the same roster the
 *      conversion sweep reconciles against).
 *   2. mosquito_service_status.sprays_this_season >= 2 (aggregated nightly from
 *      respray_jobs — completed mosquito services of ANY type).
 *   3. No wellness_calls row for CURRENT_YEAR (the season re-entry guard).
 *   4. Not already in the Queue folder — dedupe by normalized 10-digit phone
 *      against the live folder listing, same as leadSync.
 *   5. Not paused on an open balance (status = 'paused_balance') while
 *      EXCLUDE_PAUSED_BALANCE is true.
 *
 * READ-ONLY against Pocomos (getDataset GETs only). Writes go to PhoneBurner
 * (contact creates + reconciliation moves) and Neon (phoneburner_contacts).
 *
 * RECONCILIATION (belt-and-suspenders): a Queue contact that already HAS a
 * wellness_calls row means the webhook recorded the call but the move to
 * Called failed — move it now instead of skipping silently.
 */

/** One-line flip if ops decides paused-balance customers should be called too. */
export const EXCLUDE_PAUSED_BALANCE = true;

const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";

export interface WellnessCandidate {
  pocomos_id: string;
  name: string;
  phone: string;
  sprays: number;
  last_spray: string | null;
  sign_up: string | null;
}

export interface WellnessFeedResult {
  dryRun: boolean;
  season: number;
  /** Active-roster size (status Active + current-year tag). */
  rosterActive: number;
  /** Eligible-set rows at 2+ sprays this season (before exclusions). */
  twoPlus: number;
  /** Excluded: already called this season (wellness_calls row). */
  alreadyCalled: number;
  /** Excluded: not on the active roster (lost status/tag since the count). */
  notActive: number;
  /** Excluded: paused on an open balance. */
  pausedSkipped: number;
  /** Excluded: no usable 10-digit phone. */
  noPhone: number;
  /** Excluded: a contact with the same phone is already in the Queue folder. */
  alreadyQueued: number;
  /** Queue contacts found in the folder at the start of the run. */
  queueSize: number;
  /** Queue contacts with a wellness_calls row → moved (or would-move) to Called. */
  reconciled: number;
  wouldPush: number;
  pushed: number;
  /** The (would-be) queue additions, sprays DESC. */
  pushList: WellnessCandidate[];
  errors: Array<{ pocomos_id: string; error: string }>;
  duration_ms: number;
}

interface StatusRow {
  pocomos_id: string;
  sprays: number;
  status: string;
  sign_up: string | null;
}

interface LastJobRow {
  customer_id: string;
  last_spray: string;
  address: string | null;
}

export async function runWellnessFeed(
  opts: { dryRun?: boolean } = {}
): Promise<WellnessFeedResult> {
  const dryRun = opts.dryRun ?? false;
  const season = Number(CURRENT_YEAR);
  const t0 = Date.now();
  await initSchema();

  const result: WellnessFeedResult = {
    dryRun,
    season,
    rosterActive: 0,
    twoPlus: 0,
    alreadyCalled: 0,
    notActive: 0,
    pausedSkipped: 0,
    noPhone: 0,
    alreadyQueued: 0,
    queueSize: 0,
    reconciled: 0,
    wouldPush: 0,
    pushed: 0,
    pushList: [],
    errors: [],
    duration_ms: 0,
  };

  // ---- Active roster (one bulk pull — same definition as the sweep). ----
  const ds = await getDataset();
  const roster = new Map<
    string,
    { first: string; last: string; full: string; phone: string; email: string; zip: string }
  >();
  for (const c of ds.customers) {
    if (String(c.status || "").toLowerCase() !== "active") continue;
    if (!c.tags.some((t) => t.trim().startsWith(`${CURRENT_YEAR} -`))) continue;
    roster.set(String(c.id), {
      first: c.firstName ?? "",
      last: c.lastName ?? "",
      full: c.fullName,
      phone: c.phone ?? "",
      email: c.email ?? "",
      zip: c.zip ?? "",
    });
  }
  result.rosterActive = roster.size;

  // ---- DB inputs: spray counts, season guard rows, latest job (date+street). ----
  const statusRows = (await sql`
    SELECT pocomos_id, sprays_this_season AS sprays, status,
           to_char(sign_up_date, 'YYYY-MM-DD') AS sign_up
      FROM mosquito_service_status
     WHERE sprays_this_season >= 2
  `) as unknown as StatusRow[];
  result.twoPlus = statusRows.length;

  const called = new Set(
    (
      (await sql`SELECT pocomos_id FROM wellness_calls WHERE season = ${season}`) as Array<{
        pocomos_id: string;
      }>
    ).map((r) => String(r.pocomos_id))
  );

  const lastJobs = new Map<string, { last: string; address: string | null }>();
  for (const r of (await sql`
    SELECT DISTINCT ON (customer_id) customer_id,
           to_char(completed_date, 'YYYY-MM-DD') AS last_spray, address
      FROM respray_jobs
     ORDER BY customer_id, completed_date DESC
  `) as unknown as LastJobRow[]) {
    lastJobs.set(String(r.customer_id), { last: r.last_spray, address: r.address });
  }

  // ---- Queue folder: phone dedupe set + reconciliation sweep. ----
  const queuePhones = new Set<string>();
  const toReconcile: Array<{ pbId: string; pocomosId: string }> = [];
  for await (const c of listContactsInFolder(WELLNESS_QUEUE_FOLDER, 500)) {
    result.queueSize += 1;
    const phone = normalizePhone(c.raw_phone);
    if (phone) queuePhones.add(phone);
    const storedId = (c.custom_fields ?? [])
      .find((f) => f.name === "Customer ID")
      ?.value?.trim();
    if (storedId && called.has(storedId) && c.user_id) {
      toReconcile.push({ pbId: String(c.user_id), pocomosId: storedId });
    }
  }

  for (const { pbId, pocomosId } of toReconcile) {
    result.reconciled += 1;
    if (dryRun) continue;
    try {
      await updateContact(pbId, { category_id: WELLNESS_CALLED_FOLDER });
      await sql`
        UPDATE phoneburner_contacts
           SET folder_id = ${WELLNESS_CALLED_FOLDER}, last_updated_at = NOW()
         WHERE pb_contact_id = ${pbId}
      `;
      console.log(
        JSON.stringify({ event: "wellnessFeed.reconciled", pb_contact_id: pbId, pocomos_id: pocomosId })
      );
    } catch (e) {
      result.errors.push({ pocomos_id: pocomosId, error: `reconcile: ${(e as Error).message}` });
    }
  }

  // ---- Candidate selection. ----
  const candidates: Array<WellnessCandidate & { email: string; zip: string; address: string | null; first: string; last: string }> = [];
  for (const row of statusRows) {
    const id = String(row.pocomos_id);
    if (called.has(id)) {
      result.alreadyCalled += 1;
      continue;
    }
    const person = roster.get(id);
    if (!person) {
      result.notActive += 1;
      continue;
    }
    if (EXCLUDE_PAUSED_BALANCE && row.status === "paused_balance") {
      result.pausedSkipped += 1;
      continue;
    }
    const phone = normalizePhone(person.phone);
    if (phone.length !== 10) {
      result.noPhone += 1;
      continue;
    }
    if (queuePhones.has(phone)) {
      result.alreadyQueued += 1;
      continue;
    }
    const job = lastJobs.get(id);
    candidates.push({
      pocomos_id: id,
      name: person.full,
      phone,
      sprays: Number(row.sprays),
      last_spray: job?.last ?? null,
      sign_up: row.sign_up,
      email: person.email,
      zip: person.zip,
      address: job?.address ?? null,
      first: person.first,
      last: person.last,
    });
    queuePhones.add(phone); // two roster customers sharing a phone → one queue entry
  }
  candidates.sort((a, b) => b.sprays - a.sprays || a.name.localeCompare(b.name));
  result.wouldPush = candidates.length;
  result.pushList = candidates.map(
    ({ pocomos_id, name, phone, sprays, last_spray, sign_up }) => ({
      pocomos_id,
      name,
      phone,
      sprays,
      last_spray,
      sign_up,
    })
  );

  if (dryRun) {
    result.duration_ms = Date.now() - t0;
    console.log(JSON.stringify({ event: "wellnessFeed.dryRun", ...summarize(result) }));
    return result;
  }

  // ---- Push (form-urlencoded; client enforces 200ms gap + backoff). ----
  for (const c of candidates) {
    const profileUrl = `${POCOMOS_BASE}/customer/${c.pocomos_id}/service-information`;
    const notes = [
      `Wellness call — active customer, ${c.sprays} sprays this season.`,
      `Last spray: ${c.last_spray ?? "(unknown)"}`,
      `Signed up: ${c.sign_up ?? "(unknown)"}`,
    ].join("\n");
    try {
      const createdContact = await createContact({
        first_name: c.first,
        last_name: c.last,
        phone: c.phone,
        email: c.email || undefined,
        address1: c.address ?? undefined,
        zip: c.zip || undefined,
        category_id: WELLNESS_QUEUE_FOLDER,
        notes,
        custom_fields: [
          { name: "Customer ID", type: 1, value: c.pocomos_id },
          { name: "Pocomos Profile", type: 1, value: profileUrl },
          { name: "Hub Source", type: 1, value: "wellness" },
        ],
      });
      const pbId = createdContact.user_id ? String(createdContact.user_id) : "";
      await sql`
        INSERT INTO phoneburner_contacts (
          pocomos_id, pocomos_type, pb_contact_id, folder_id,
          synced_at, last_updated_at, last_notes_refresh_at
        ) VALUES (
          ${c.pocomos_id}, 'customer', ${pbId}, ${WELLNESS_QUEUE_FOLDER},
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (pocomos_id) DO UPDATE
          SET pocomos_type = 'customer',
              pb_contact_id = EXCLUDED.pb_contact_id,
              folder_id = EXCLUDED.folder_id,
              last_updated_at = NOW(),
              last_notes_refresh_at = NOW()
      `;
      result.pushed += 1;
    } catch (e) {
      result.errors.push({ pocomos_id: c.pocomos_id, error: (e as Error).message });
    }
  }

  result.duration_ms = Date.now() - t0;
  console.log(JSON.stringify({ event: "wellnessFeed.live", ...summarize(result) }));
  return result;
}

function summarize(r: WellnessFeedResult) {
  return {
    season: r.season,
    rosterActive: r.rosterActive,
    twoPlus: r.twoPlus,
    alreadyCalled: r.alreadyCalled,
    notActive: r.notActive,
    pausedSkipped: r.pausedSkipped,
    noPhone: r.noPhone,
    alreadyQueued: r.alreadyQueued,
    queueSize: r.queueSize,
    reconciled: r.reconciled,
    wouldPush: r.wouldPush,
    pushed: r.pushed,
    errors: r.errors.length,
    duration_ms: r.duration_ms,
  };
}
