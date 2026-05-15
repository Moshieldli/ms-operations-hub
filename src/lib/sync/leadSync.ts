import { sql, getSyncState, setSyncState, initSchema } from "@/lib/db";
import { postSessioned } from "@/lib/pocomos/webSession";
import { getNotesForLead, formatNotesForPhoneBurner } from "@/lib/pocomos/notes";
import {
  createContact,
  listContactsInFolder,
  normalizePhone,
} from "@/lib/phoneburner/client";
import { FOLDERS } from "@/lib/phoneburner/folders";

const WATERMARK_KEY = "phoneburner_last_sync_at";
const PAGE_SIZE = 100;
const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";

/**
 * Shape of one row in the `aaData` array returned by POST /leads/data. The
 * Pocomos DataTables endpoint emits objects keyed by column name; column set
 * is inferred from probe output (see scripts/probe-pocomos-web-login.ts).
 * Every field is optional because the schema is whatever the UI happens to
 * render — we soft-fail rather than crashing when a key is missing.
 */
export interface PocomosLeadRow {
  id?: string | number;
  lead_id?: string | number;
  first_name?: string;
  last_name?: string;
  firstname?: string;
  lastname?: string;
  name?: string;
  phone?: string;
  phone_number?: string;
  email?: string;
  email_address?: string;
  street?: string;
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  region?: string;
  zip?: string;
  postal_code?: string;
  postalcode?: string;
  date_added?: string;
  created_at?: string;
  marketing_type_name?: string;
  status?: string;
  [k: string]: unknown;
}

interface LeadsDataResponse {
  aaData?: PocomosLeadRow[];
  data?: PocomosLeadRow[];
  iTotalRecords?: number;
  iTotalDisplayRecords?: number;
  recordsTotal?: number;
  recordsFiltered?: number;
  type?: string;
  redirect?: string;
}

export interface LeadSyncResult {
  added: number;
  skipped_dup: number;
  skipped_nophone: number;
  errors: Array<{ pocomos_id: string; error: string }>;
  duration_ms: number;
  watermark_before: string | null;
  watermark_after: string | null;
  pages_fetched: number;
  /** When DRY_RUN, the (would-be) PhoneBurner payloads we'd POST. */
  dry_run_preview?: Array<{ lead_id: string; payload: Record<string, unknown>; notes_block: string }>;
}

interface RunOptions {
  /** Hard cap on leads processed in this invocation. Default unlimited. */
  limit?: number;
  /** When true, no PhoneBurner writes and no DB writes — just log what would happen. */
  dryRun?: boolean;
}

function pickStr(row: PocomosLeadRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = (row as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function leadIdOf(row: PocomosLeadRow): string {
  const raw = row.id ?? row.lead_id ?? "";
  return typeof raw === "number" ? String(raw) : raw;
}

function splitName(row: PocomosLeadRow): { first: string; last: string } {
  const first = pickStr(row, "first_name", "firstname");
  const last = pickStr(row, "last_name", "lastname");
  if (first || last) return { first, last };
  const full = pickStr(row, "name");
  if (!full) return { first: "", last: "" };
  const parts = full.split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function dateAddedOf(row: PocomosLeadRow): string {
  const raw = pickStr(row, "date_added", "created_at");
  // Common shape is "YYYY-MM-DD HH:MM:SS" — Date.parse handles it.
  return raw;
}

async function fetchLeadsPage(start: number): Promise<LeadsDataResponse> {
  const body = new URLSearchParams();
  body.set("draw", "1");
  body.set("sEcho", "1");
  // Pocomos's DataTables endpoint only honors the legacy 1.9 pagination keys
  // (`iDisplayStart` / `iDisplayLength`) — the modern `start` / `length` are
  // accepted but ignored, so the page never advances. Send both for safety.
  body.set("start", String(start));
  body.set("length", String(PAGE_SIZE));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  body.append("statuses[]", "Lead");
  body.set("search[value]", "");
  body.set("search[regex]", "false");
  body.set("order[0][column]", "0");
  body.set("order[0][dir]", "desc");
  return postSessioned<LeadsDataResponse>("/leads/data", body, { referer: "/leads" });
}

async function loadAlreadySyncedIds(): Promise<Set<string>> {
  const rows = (await sql`SELECT pocomos_id FROM phoneburner_contacts`) as Array<{
    pocomos_id: string;
  }>;
  return new Set(rows.map((r) => r.pocomos_id));
}

async function loadFreshFolderPhones(): Promise<Set<string>> {
  const phones = new Set<string>();
  for await (const c of listContactsInFolder(FOLDERS.LEADS_FRESH)) {
    const norm = normalizePhone(c.raw_phone);
    if (norm) phones.add(norm);
  }
  return phones;
}

/**
 * Pull all "Lead"-status leads from Pocomos with `date_added > watermark`,
 * dedup against `phoneburner_contacts` and the Fresh folder, push the
 * survivors to PhoneBurner with their formatted notes block. Bumps the
 * watermark to `max(date_added)` of the leads actually processed.
 *
 * Idempotent: if it crashes mid-batch the next run picks up everything
 * after the most recently committed lead's `date_added`.
 */
export async function runLeadSync(opts: RunOptions = {}): Promise<LeadSyncResult> {
  const t0 = Date.now();
  await initSchema();

  const watermarkRow = await getSyncState<{ timestamp?: string }>(WATERMARK_KEY);
  const watermarkBefore = watermarkRow?.timestamp || null;
  const watermarkBeforeMs = watermarkBefore ? Date.parse(watermarkBefore) : 0;

  const result: LeadSyncResult = {
    added: 0,
    skipped_dup: 0,
    skipped_nophone: 0,
    errors: [],
    duration_ms: 0,
    watermark_before: watermarkBefore,
    watermark_after: watermarkBefore,
    pages_fetched: 0,
    dry_run_preview: opts.dryRun ? [] : undefined,
  };

  const alreadySynced = opts.dryRun ? new Set<string>() : await loadAlreadySyncedIds();
  const freshPhones = opts.dryRun ? new Set<string>() : await loadFreshFolderPhones();

  let processed = 0;
  let newWatermarkMs = watermarkBeforeMs;
  let start = 0;

  outer: for (;;) {
    const page = await fetchLeadsPage(start);
    result.pages_fetched += 1;
    const rows = page.aaData ?? page.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const leadId = leadIdOf(row);
      if (!leadId) continue;

      const dateAdded = dateAddedOf(row);
      const dateAddedMs = dateAdded ? Date.parse(dateAdded) : 0;

      // Pages come ordered desc — once we drop below the watermark, the rest
      // of the response is older and we can stop early.
      if (watermarkBeforeMs && dateAddedMs && dateAddedMs <= watermarkBeforeMs) {
        break outer;
      }

      if (opts.limit && processed >= opts.limit) break outer;
      processed += 1;

      const phoneRaw = pickStr(row, "phone", "phone_number");
      const phone = normalizePhone(phoneRaw);
      if (!phone) {
        result.skipped_nophone += 1;
        continue;
      }

      if (alreadySynced.has(leadId)) {
        result.skipped_dup += 1;
        continue;
      }
      if (freshPhones.has(phone)) {
        result.skipped_dup += 1;
        continue;
      }

      const { first, last } = splitName(row);
      const email = pickStr(row, "email_address", "email");
      const street = pickStr(row, "street", "address1", "address");
      const city = pickStr(row, "city");
      const state = pickStr(row, "state", "region");
      const zip = pickStr(row, "zip", "postal_code", "postalcode");
      const pocomosUrl = `${POCOMOS_BASE}/lead/${leadId}/lead-information`;

      let notesBlock = "";
      try {
        const notes = await getNotesForLead(leadId);
        notesBlock = formatNotesForPhoneBurner(notes, pocomosUrl);
      } catch (e) {
        // Notes are non-essential — log and proceed with empty block.
        console.warn(
          JSON.stringify({
            event: "leadSync.notes.error",
            lead_id: leadId,
            error: (e as Error).message,
          })
        );
      }

      const payload = {
        first_name: first,
        last_name: last,
        raw_phone: phone,
        email_address: email,
        address1: street,
        city,
        state,
        zip,
        category_id: FOLDERS.LEADS_FRESH,
        website: pocomosUrl,
        custom_fields: [{ name: "Customer ID", type: 1, value: leadId }],
        notes: notesBlock,
      };

      if (opts.dryRun) {
        result.dry_run_preview!.push({
          lead_id: leadId,
          payload: payload as Record<string, unknown>,
          notes_block: notesBlock,
        });
        if (dateAddedMs > newWatermarkMs) newWatermarkMs = dateAddedMs;
        continue;
      }

      try {
        const created = await createContact(payload);
        const pbId = created.user_id ? String(created.user_id) : "";
        await sql`
          INSERT INTO phoneburner_contacts (
            pocomos_id, pocomos_type, pb_contact_id, folder_id,
            synced_at, last_updated_at, last_notes_refresh_at
          ) VALUES (
            ${leadId}, 'lead', ${pbId}, ${FOLDERS.LEADS_FRESH},
            NOW(), NOW(), NOW()
          )
          ON CONFLICT (pocomos_id) DO UPDATE
            SET pb_contact_id = EXCLUDED.pb_contact_id,
                folder_id = EXCLUDED.folder_id,
                last_updated_at = NOW(),
                last_notes_refresh_at = NOW()
        `;
        alreadySynced.add(leadId);
        freshPhones.add(phone);
        result.added += 1;
        if (dateAddedMs > newWatermarkMs) newWatermarkMs = dateAddedMs;
      } catch (e) {
        result.errors.push({ pocomos_id: leadId, error: (e as Error).message });
      }
    }

    if (rows.length < PAGE_SIZE) break;
    if (opts.limit && processed >= opts.limit) break;
    start += PAGE_SIZE;
    if (start > 50_000) break; // sanity guard
  }

  if (!opts.dryRun && newWatermarkMs > watermarkBeforeMs) {
    const iso = new Date(newWatermarkMs).toISOString();
    await setSyncState(WATERMARK_KEY, { timestamp: iso });
    result.watermark_after = iso;
  }

  result.duration_ms = Date.now() - t0;
  return result;
}
