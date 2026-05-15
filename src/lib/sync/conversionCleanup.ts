import { sql, initSchema } from "@/lib/db";
import {
  fetchAllCustomers,
  pocomosOffice,
  postJson,
  getJson,
} from "@/lib/pocomos";
import { POCOMOS_CALL_INTERACTION_TYPE } from "@/lib/pocomos/interactionTypes";
import { getNotesForLead, getNotesForCustomer, formatNotesForPhoneBurner } from "@/lib/pocomos/notes";
import { updateContact } from "@/lib/phoneburner/client";
import { FOLDERS, OUTBOUND_FOLDERS } from "@/lib/phoneburner/folders";

const NOTES_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";

export interface ConversionCleanupResult {
  moved: number;
  refreshed_notes: number;
  checked: number;
  errors: Array<{ pocomos_id: string; error: string }>;
  duration_ms: number;
}

interface TrackedContact {
  pocomos_id: string;
  pocomos_type: "lead" | "customer";
  pb_contact_id: string;
  folder_id: string;
  last_notes_refresh_at: string | null;
}

async function loadOutboundContacts(): Promise<TrackedContact[]> {
  const placeholders = OUTBOUND_FOLDERS;
  const rows = (await sql`
    SELECT pocomos_id, pocomos_type, pb_contact_id, folder_id,
           last_notes_refresh_at
      FROM phoneburner_contacts
     WHERE folder_id = ANY(${placeholders}::text[])
  `) as TrackedContact[];
  return rows;
}

interface LeadDetailResponse {
  response?: { id?: string | number; status?: { value?: string } };
}

/**
 * Returns true when the lead's Pocomos record is no longer in `Lead` status
 * (i.e. it was converted to a customer or otherwise resolved). Network errors
 * are swallowed and treated as "no change" — we'd rather skip a cycle than
 * accidentally move a contact out of an outbound folder on a transient blip.
 */
async function leadHasConverted(leadId: string): Promise<boolean> {
  try {
    const detail = await getJson<LeadDetailResponse>(`/jwt/${pocomosOffice()}/lead/${leadId}`);
    const status = detail.response?.status?.value;
    if (!status) return false;
    // Anything other than the open lead pipeline values implies it left the funnel.
    const stillALead = ["Lead", "Not Home", "Not Interested", "Monitor", "Do Not Knock"];
    return !stillALead.includes(status);
  } catch {
    return false;
  }
}

function buildActiveCustomerIdSet(
  customers: Awaited<ReturnType<typeof fetchAllCustomers>>
): Set<string> {
  const ids = new Set<string>();
  for (const c of customers) {
    if (String(c.status || "").toLowerCase() !== "active") continue;
    // Both internal id and the user-facing customer number can appear in
    // phoneburner_contacts.pocomos_id depending on which surface created the
    // row. Add every plausible identifier.
    if (c.id != null) ids.add(String(c.id));
    const num = c.customer_number ?? c.customerNumber;
    if (num != null) ids.add(String(num));
    const ext = (c as Record<string, unknown>).external_account_id;
    if (ext != null) ids.add(String(ext));
  }
  return ids;
}

async function writePocomosCustomerNote(urlId: string, summary: string): Promise<void> {
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

async function writePocomosLeadNote(leadId: string, summary: string): Promise<void> {
  // Lead-note path is unverified (see §9 of REFERENCE.md). Try POST and
  // swallow 404 so we don't block the cleanup pass.
  try {
    await postJson(`/jwt/${pocomosOffice()}/lead/${leadId}/note`, { note: { summary } });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/failed:\s*404/.test(msg)) throw e;
    console.warn(
      JSON.stringify({
        event: "conversionCleanup.lead_note.404",
        lead_id: leadId,
        error: msg,
      })
    );
  }
}

/**
 * Walks every contact we've placed in an outbound (lead or cancelled)
 * folder and either:
 *   1) moves it to ACTIVE_CUSTOMER if Pocomos says it converted, or
 *   2) refreshes its formatted notes block when the cached copy is >24h old.
 *
 * The ordering matters: a contact that just converted gets its notes
 * refreshed implicitly via the move (we re-pull and re-format), so we
 * don't double-bill the notes refresh in the same pass.
 */
export async function runConversionCleanup(): Promise<ConversionCleanupResult> {
  const t0 = Date.now();
  await initSchema();

  const result: ConversionCleanupResult = {
    moved: 0,
    refreshed_notes: 0,
    checked: 0,
    errors: [],
    duration_ms: 0,
  };

  const tracked = await loadOutboundContacts();
  if (tracked.length === 0) {
    result.duration_ms = Date.now() - t0;
    return result;
  }

  // Pull active customers once and build a lookup set so the per-contact
  // check is O(1) instead of N HTTPs.
  const allCustomers = await fetchAllCustomers().catch(() => []);
  const activeCustomerIds = buildActiveCustomerIdSet(allCustomers);

  const now = Date.now();

  for (const contact of tracked) {
    result.checked += 1;
    try {
      let converted = false;
      if (contact.pocomos_type === "customer") {
        converted = activeCustomerIds.has(contact.pocomos_id);
      } else {
        // For leads, a fresh detail call is the only way to know — but
        // limit the network fan-out by short-circuiting if the customer
        // list happens to contain the lead id (some shops carry both).
        if (activeCustomerIds.has(contact.pocomos_id)) {
          converted = true;
        } else {
          converted = await leadHasConverted(contact.pocomos_id);
        }
      }

      if (converted) {
        await updateContact(contact.pb_contact_id, { category_id: FOLDERS.ACTIVE_CUSTOMER });
        await sql`
          UPDATE phoneburner_contacts
             SET folder_id = ${FOLDERS.ACTIVE_CUSTOMER},
                 last_updated_at = NOW()
           WHERE pocomos_id = ${contact.pocomos_id}
        `;
        const moveNote = "Moved out of PhoneBurner outbound — now Active";
        if (contact.pocomos_type === "customer") {
          await writePocomosCustomerNote(contact.pocomos_id, moveNote);
        } else {
          await writePocomosLeadNote(contact.pocomos_id, moveNote);
        }
        result.moved += 1;
        continue;
      }

      const lastRefresh = contact.last_notes_refresh_at
        ? Date.parse(contact.last_notes_refresh_at)
        : 0;
      const ageMs = now - lastRefresh;
      if (ageMs <= NOTES_REFRESH_AGE_MS) continue;

      const url =
        contact.pocomos_type === "lead"
          ? `${POCOMOS_BASE}/lead/${contact.pocomos_id}/lead-information`
          : `${POCOMOS_BASE}/customer/${contact.pocomos_id}/customer-information`;
      const notes =
        contact.pocomos_type === "lead"
          ? await getNotesForLead(contact.pocomos_id)
          : await getNotesForCustomer(contact.pocomos_id);
      const block = formatNotesForPhoneBurner(notes, url);
      await updateContact(contact.pb_contact_id, { notes: block });
      await sql`
        UPDATE phoneburner_contacts
           SET last_notes_refresh_at = NOW()
         WHERE pocomos_id = ${contact.pocomos_id}
      `;
      result.refreshed_notes += 1;
    } catch (e) {
      result.errors.push({ pocomos_id: contact.pocomos_id, error: (e as Error).message });
    }
  }

  result.duration_ms = Date.now() - t0;
  return result;
}
