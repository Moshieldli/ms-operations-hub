import { sql, initSchema } from "@/lib/db";
import { getNotesForLead, getNotesForCustomer, formatNotesForPhoneBurner } from "@/lib/pocomos/notes";
import { updateContact } from "@/lib/phoneburner/client";
import { POLICED_FOLDERS } from "@/lib/phoneburner/folders";

const NOTES_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";

export interface NotesRefreshResult {
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

/**
 * Lazy Pocomos → PhoneBurner notes refresh for TRACKED contacts still sitting
 * in a policed (dial/cancelled) folder. Pulls the latest Pocomos notes and
 * rewrites the PB `notes` field, but only when the cached copy is >24h old, so
 * the every-15-min pass stays cheap.
 *
 * This used to live inside conversionCleanup alongside the folder moves. The
 * moves are now the hourly roster-reconciliation sweep (conversionSweep.ts);
 * this is purely the notes half, and it only READS Pocomos + writes the PB
 * notes field — it never moves a contact. READ-ONLY against Pocomos.
 */
export async function refreshTrackedNotes(
  limit = Number(process.env.NOTES_REFRESH_LIMIT || 40)
): Promise<NotesRefreshResult> {
  const t0 = Date.now();
  await initSchema();

  const result: NotesRefreshResult = {
    refreshed_notes: 0,
    checked: 0,
    errors: [],
    duration_ms: 0,
  };

  // Oldest-first so every tracked contact eventually cycles through.
  const cutoffIso = new Date(Date.now() - NOTES_REFRESH_AGE_MS).toISOString();
  const tracked = (await sql`
    SELECT pocomos_id, pocomos_type, pb_contact_id, folder_id, last_notes_refresh_at
      FROM phoneburner_contacts
     WHERE folder_id = ANY(${POLICED_FOLDERS}::text[])
       AND (last_notes_refresh_at IS NULL OR last_notes_refresh_at < ${cutoffIso})
     ORDER BY last_notes_refresh_at ASC NULLS FIRST
     LIMIT ${limit}
  `) as TrackedContact[];

  for (const contact of tracked) {
    result.checked += 1;
    try {
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
