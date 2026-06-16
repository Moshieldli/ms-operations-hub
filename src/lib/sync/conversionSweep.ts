import { sql, initSchema } from "@/lib/db";
import { getDataset } from "@/lib/pocomos/dataset";
import { CURRENT_YEAR } from "@/lib/pocomos/categorize";
import {
  listContactsInFolder,
  updateContact,
  normalizePhone,
  type PBContact,
} from "@/lib/phoneburner/client";
import {
  POLICED_FOLDERS,
  DESTINATION_FOLDER,
  EXEMPT_FOLDERS,
} from "@/lib/phoneburner/folders";

/**
 * Conversion sweep — roster-reconciliation model.
 *
 * THE PROBLEM THIS FIXES: converting a Pocomos lead does NOT flip the lead's
 * status to "Customer". It creates a brand-new customer record and leaves the
 * lead frozen at status "Lead", with no id link back. The old cleanup also
 * only iterated the `phoneburner_contacts` Neon table, so the thousands of
 * bulk-imported (CSV) PhoneBurner contacts were never evaluated at all.
 *
 * THE NEW MODEL: stop trying to DETECT conversions. Each run, walk every
 * contact LIVE in the policed (dial/cancelled) folders and ask one question —
 * "is this contact a current active customer right now?" — then sweep matches
 * out to the Active Customer folder.
 *
 *   ACTIVE = the SAME definition the Sales dashboard headline uses:
 *            status Active AND at least one tag starting with "{CURRENT_YEAR} -".
 *
 * MATCHING a policed contact to the roster:
 *   a) stored "Customer ID" custom field ∈ activeByCustomerId  -> match (by id)
 *   b) else phone ∈ activeByPhone AND last name matches         -> match (phone bridge)
 *   c) phone matches but last name differs                      -> SKIP, log for review
 *   d) no match                                                 -> leave in place
 *
 * The phone bridge (b) exists for orphaned lead contacts and CSV contacts whose
 * stored id is a frozen lead id or an external customer number that the roster
 * (keyed on Pocomos internal customer id) can't match directly.
 *
 * READ-ONLY against Pocomos (GET only via getDataset). The ONLY writes are to
 * PhoneBurner (PUT category_id to move a contact) and to the Neon cache table.
 * Idempotent: once everyone is in Active Customer they leave the policed
 * folders, so a re-run moves nobody. A person split across two policed contacts
 * (e.g. a frozen lead + a cancelled-customer contact) matches on both and both
 * are correctly moved.
 */

const DASH = "—";

export interface ConversionSweepResult {
  dryRun: boolean;
  scanned: number;
  matchedById: number;
  matchedByPhone: number;
  nameMismatchSkipped: number;
  noMatch: number;
  /** Distinct contacts the sweep would move / did move. */
  wouldMove: number;
  moved: number;
  rosterActiveCount: number;
  perFolder: Record<string, { scanned: number; matched: number }>;
  /** Contacts skipped on the name-mismatch guard — surfaced for manual review. */
  reviews: Array<{
    folder_id: string;
    pb_contact_id: string;
    name: string;
    phone: string;
    roster_last_name: string;
    roster_customer_id: string;
  }>;
  /** Per-contact outcome for any pb ids passed in opts.trackPbIds (debug/verify). */
  tracked: Array<{
    pb_contact_id: string;
    folder_id: string;
    name: string;
    stored_customer_id: string;
    phone: string;
    kind: MatchKind;
    resolved_customer_id: string;
    would_move: boolean;
  }>;
  errors: Array<{ pb_contact_id: string; error: string }>;
  duration_ms: number;
}

interface ActiveRoster {
  /** Normalized Pocomos internal customer ids of current active customers. */
  byCustomerId: Set<string>;
  /** normalized-10-digit-phone -> { customerId (internal), lastName (lower) }. */
  byPhone: Map<string, { customerId: string; lastName: string }>;
  activeCount: number;
}

function hasCurrentYearTag(tags: string[]): boolean {
  return tags.some((t) => t.trim().startsWith(`${CURRENT_YEAR} -`));
}

/**
 * Build the active roster from the dashboard's canonical dataset (getDataset —
 * the same source behind the /sales "Active Customers" headline). One bulk
 * pull, cached for the run; no per-contact Pocomos calls in the sweep.
 *
 * NOTE: getDataset exposes the Pocomos INTERNAL customer id and per-customer
 * union tags + phone + last name. It does NOT expose the user-facing external
 * customer number, and that number is not available in any bulk Pocomos source
 * (confirmed live: /customers/data and the JWT customer-list both key on the
 * internal id; find-customer-by-office returns nothing in bulk). So
 * byCustomerId holds internal ids — a correct, cheap identity check — and the
 * phone bridge carries contacts whose stored id is an external number or a
 * frozen lead id.
 */
async function buildActiveRoster(): Promise<ActiveRoster> {
  const ds = await getDataset();
  const byCustomerId = new Set<string>();
  const byPhone = new Map<string, { customerId: string; lastName: string }>();
  let activeCount = 0;

  for (const c of ds.customers) {
    if (String(c.status || "").toLowerCase() !== "active") continue;
    if (!hasCurrentYearTag(c.tags)) continue;
    activeCount++;
    const id = String(c.id);
    byCustomerId.add(id);
    const phone = normalizePhone(c.phone);
    if (phone.length === 10) {
      // First write wins; active ids are unique enough that collisions are rare
      // and either resolution is an active customer anyway.
      if (!byPhone.has(phone)) {
        byPhone.set(phone, { customerId: id, lastName: String(c.lastName || "").toLowerCase().trim() });
      }
    }
  }

  return { byCustomerId, byPhone, activeCount };
}

function storedCustomerId(c: PBContact): string {
  const cf = (c.custom_fields ?? []).find((f) => f.name === "Customer ID");
  return cf?.value != null ? String(cf.value).trim() : "";
}

type MatchKind = "id" | "phone" | "name_mismatch" | "none";

interface MatchOutcome {
  kind: MatchKind;
  /** Resolved active internal customer id (for id + phone matches). */
  resolvedCustomerId?: string;
  /** Roster last name, only set for name_mismatch (review surfacing). */
  rosterLastName?: string;
  rosterCustomerId?: string;
}

function classify(c: PBContact, roster: ActiveRoster): MatchOutcome {
  const cid = storedCustomerId(c);
  if (cid && roster.byCustomerId.has(cid)) {
    return { kind: "id", resolvedCustomerId: cid };
  }
  const phone = normalizePhone(c.raw_phone);
  if (phone.length === 10 && roster.byPhone.has(phone)) {
    const cust = roster.byPhone.get(phone)!;
    const contactLast = String(c.last_name || "").toLowerCase().trim();
    if (cust.lastName && contactLast && cust.lastName === contactLast) {
      return { kind: "phone", resolvedCustomerId: cust.customerId };
    }
    return {
      kind: "name_mismatch",
      rosterLastName: cust.lastName,
      rosterCustomerId: cust.customerId,
    };
  }
  return { kind: "none" };
}

/**
 * Move a matched contact to the Active Customer folder and update the Neon
 * cache. The cache is keyed on pocomos_id (the resolved internal customer id);
 * we also re-point any stale row carrying the SAME pb_contact_id (e.g. a frozen
 * lead row) at the destination so the cache stays consistent.
 */
async function moveContact(pbContactId: string, resolvedCustomerId: string): Promise<void> {
  await updateContact(pbContactId, { category_id: DESTINATION_FOLDER });
  await sql`
    INSERT INTO phoneburner_contacts (pocomos_id, pocomos_type, pb_contact_id, folder_id, last_updated_at)
    VALUES (${resolvedCustomerId}, 'customer', ${pbContactId}, ${DESTINATION_FOLDER}, NOW())
    ON CONFLICT (pocomos_id) DO UPDATE
      SET pocomos_type = 'customer',
          pb_contact_id = EXCLUDED.pb_contact_id,
          folder_id = ${DESTINATION_FOLDER},
          last_updated_at = NOW()
  `;
  await sql`
    UPDATE phoneburner_contacts
       SET folder_id = ${DESTINATION_FOLDER}, last_updated_at = NOW()
     WHERE pb_contact_id = ${pbContactId} AND pocomos_id <> ${resolvedCustomerId}
  `;
}

export async function runConversionSweep(
  opts: { dryRun?: boolean; trackPbIds?: Array<string | number> } = {}
): Promise<ConversionSweepResult> {
  const dryRun = opts.dryRun ?? false;
  const trackSet = new Set((opts.trackPbIds ?? []).map(String));
  const t0 = Date.now();
  await initSchema();

  const roster = await buildActiveRoster();

  const result: ConversionSweepResult = {
    dryRun,
    scanned: 0,
    matchedById: 0,
    matchedByPhone: 0,
    nameMismatchSkipped: 0,
    noMatch: 0,
    wouldMove: 0,
    moved: 0,
    rosterActiveCount: roster.activeCount,
    perFolder: {},
    reviews: [],
    tracked: [],
    errors: [],
    duration_ms: 0,
  };

  // Structural exemption guard: never walk an exempt folder, even if one is
  // mistakenly added to POLICED_FOLDERS in the future.
  const exempt = new Set<string>(EXEMPT_FOLDERS.map(String));
  const policed = POLICED_FOLDERS.filter((f) => !exempt.has(String(f)));

  // PHASE 1 — READ. Fully enumerate each policed folder and classify, with NO
  // writes. Moving a contact mid-walk shrinks the folder and shifts pagination
  // (page_size offsets slide), which can skip later contacts in the same pass.
  // Collecting first, moving after, keeps a single run complete and correct.
  const toMove: Array<{ pbId: string; resolvedCustomerId: string }> = [];

  for (const folder of policed) {
    const key = String(folder);
    result.perFolder[key] = { scanned: 0, matched: 0 };
    for await (const contact of listContactsInFolder(folder, 500)) {
      result.scanned += 1;
      result.perFolder[key].scanned += 1;
      const pbId = contact.user_id != null ? String(contact.user_id) : "";

      const outcome = classify(contact, roster);

      if (trackSet.has(pbId)) {
        const k = outcome.kind;
        result.tracked.push({
          pb_contact_id: pbId,
          folder_id: key,
          name: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
          stored_customer_id: storedCustomerId(contact),
          phone: normalizePhone(contact.raw_phone),
          kind: k,
          resolved_customer_id: outcome.resolvedCustomerId ?? "",
          would_move: k === "id" || k === "phone",
        });
      }

      if (outcome.kind === "none") {
        result.noMatch += 1;
        continue;
      }
      if (outcome.kind === "name_mismatch") {
        result.nameMismatchSkipped += 1;
        result.reviews.push({
          folder_id: key,
          pb_contact_id: pbId,
          name: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
          phone: normalizePhone(contact.raw_phone),
          roster_last_name: outcome.rosterLastName ?? "",
          roster_customer_id: outcome.rosterCustomerId ?? "",
        });
        console.warn(
          JSON.stringify({
            event: "conversionSweep.name_mismatch_review",
            folder_id: key,
            pb_contact_id: pbId,
            contact_last_name: contact.last_name,
            roster_last_name: outcome.rosterLastName,
            phone: normalizePhone(contact.raw_phone),
          })
        );
        continue;
      }

      // outcome.kind is "id" or "phone" -> a real match.
      if (outcome.kind === "id") result.matchedById += 1;
      else result.matchedByPhone += 1;
      result.wouldMove += 1;
      result.perFolder[key].matched += 1;

      if (!pbId) {
        result.errors.push({ pb_contact_id: "", error: "match with no PB user_id" });
        continue;
      }
      toMove.push({ pbId, resolvedCustomerId: outcome.resolvedCustomerId! });
    }
  }

  // PHASE 2 — WRITE. Move every matched contact to the Active Customer folder.
  if (!dryRun) {
    for (const { pbId, resolvedCustomerId } of toMove) {
      try {
        await moveContact(pbId, resolvedCustomerId);
        result.moved += 1;
      } catch (e) {
        result.errors.push({ pb_contact_id: pbId, error: (e as Error).message });
      }
    }
  }

  result.duration_ms = Date.now() - t0;
  console.log(
    JSON.stringify({
      event: dryRun ? "conversionSweep.dryRun" : "conversionSweep.live",
      scanned: result.scanned,
      matchedById: result.matchedById,
      matchedByPhone: result.matchedByPhone,
      nameMismatchSkipped: result.nameMismatchSkipped,
      wouldMove: result.wouldMove,
      moved: result.moved,
      rosterActiveCount: result.rosterActiveCount,
      duration_ms: result.duration_ms,
      note: dryRun ? `dry run ${DASH} no PhoneBurner writes` : undefined,
    })
  );
  return result;
}
