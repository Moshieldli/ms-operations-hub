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
const PAGE_SIZE = 200;
const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Column layout the Pocomos /leads UI declares to its DataTables widget.
// Indexes matter: iSortCol_0 = 5 means "sort by date_added desc" — the
// endpoint resolves the index to the field name via these mDataProp_N
// declarations, so the array order is load-bearing, not cosmetic.
const LEADS_COLUMNS = [
  "name_with_company",
  "address",
  "phone",
  "map_code",
  "status",
  "date_added",
  "salesperson",
  "note",
  "function",
] as const;
const DATE_ADDED_COL_INDEX = LEADS_COLUMNS.indexOf("date_added");

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
  // Pocomos /leads/data is DataTables 1.9 server-side, NOT 1.10+. Modern
  // params (`start`, `length`, `search[value]`, `order[0][column]`) are
  // silently ignored — the endpoint returns its default view regardless,
  // which is why earlier versions of this code saw a frozen window topped
  // at 2024-12-17 and Karen/Saul never surfaced. The legacy body below
  // matches exactly what the browser UI sends; the 9 mDataProp_N entries
  // are required so iSortCol_0=5 resolves to `date_added`.
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(LEADS_COLUMNS.length));
  body.set("sColumns", ",".repeat(LEADS_COLUMNS.length - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  for (let i = 0; i < LEADS_COLUMNS.length; i++) {
    body.set(`mDataProp_${i}`, LEADS_COLUMNS[i]);
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, i === LEADS_COLUMNS.length - 1 ? "false" : "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortCol_0", String(DATE_ADDED_COL_INDEX));
  body.set("sSortDir_0", "desc");
  body.set("iSortingCols", "1");
  body.append("statuses[]", "Lead");
  body.set("salesperson", "");
  return postSessioned<LeadsDataResponse>("/leads/data", body, { referer: "/leads/" });
}

async function loadAlreadySyncedIds(): Promise<Set<string>> {
  const rows = (await sql`SELECT pocomos_id FROM phoneburner_contacts`) as Array<{
    pocomos_id: string;
  }>;
  return new Set(rows.map((r) => r.pocomos_id));
}

/**
 * Loads the phone set we dedup against — every contact that already
 * exists ANYWHERE in PhoneBurner. Pocomos has three lifecycle states
 * (Lead → Active Customer → Cancelled) and they don't cross back: a
 * cancelled customer never reverts to a lead, and an active customer
 * never demotes either. So if a phone is already in any PB folder
 * (lead bucket, cancelled bucket, active customer, no-add-ons, follow
 * up, or the catch-all), the lead is the same person and we should not
 * duplicate. Spanning all business folders prevents that.
 *
 * Sample Contacts (66223502) and Test Folder (66224471) are excluded —
 * they're PB defaults / test scratch space, not customer-real data.
 */
async function loadAllExistingPbPhones(): Promise<Set<string>> {
  const phones = new Set<string>();
  const folders: string[] = [
    FOLDERS.LEADS_FRESH,
    FOLDERS.LEADS_GENERAL,
    FOLDERS.LEADS_COMPETITOR,
    FOLDERS.LEADS_FINANCIAL,
    FOLDERS.CANCELLED_COMPETITOR,
    FOLDERS.CANCELLED_FINANCIAL,
    FOLDERS.CANCELLED_RESULTS,
    FOLDERS.CANCELLED_NO_REACH,
    FOLDERS.CANCELLED_PERSONAL,
    FOLDERS.ACTIVE_CUSTOMER,
    FOLDERS.FOLLOW_UP,
    FOLDERS.DEFAULT_CONTACTS,
  ];
  for (const folder of folders) {
    for await (const c of listContactsInFolder(folder)) {
      const norm = normalizePhone(c.raw_phone);
      if (norm) phones.add(norm);
    }
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
  const existingPbPhones = opts.dryRun ? new Set<string>() : await loadAllExistingPbPhones();

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

      // Response is now sorted desc by date_added, but skip-not-stop on stale
      // rows: defensive against future sort drift, and a no-op when the sort
      // is honored (the page boundary stops us before we touch real history).
      if (watermarkBeforeMs && dateAddedMs && dateAddedMs <= watermarkBeforeMs) {
        continue;
      }

      if (opts.limit && processed >= opts.limit) break outer;
      processed += 1;

      // Advance the watermark for every lead we resolve (added or skipped),
      // not just on successful creates. Otherwise, a page where every lead
      // dedup-skips leaves the watermark at its previous value and the next
      // cron tick re-fetches the same page, re-skips it, and never reaches
      // older leads — the sync gets stuck on its first page. Errored creates
      // intentionally do NOT advance the watermark (the lead retries next tick).
      const advanceWatermark = () => {
        if (dateAddedMs > newWatermarkMs) newWatermarkMs = dateAddedMs;
      };

      const phoneRaw = pickStr(row, "phone", "phone_number");
      const phone = normalizePhone(phoneRaw);
      if (!phone) {
        result.skipped_nophone += 1;
        advanceWatermark();
        continue;
      }

      if (alreadySynced.has(leadId)) {
        result.skipped_dup += 1;
        advanceWatermark();
        continue;
      }
      if (existingPbPhones.has(phone)) {
        result.skipped_dup += 1;
        advanceWatermark();
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

      // Age-based folder routing: leads with date_added in the last 30
      // days go to Fresh (Rena's active queue); older ones go to General
      // so historical backfill doesn't drown the Fresh folder. Threshold
      // is from `now`, not from `last_sync_at` — a stale lead is stale
      // regardless of when we got around to syncing it.
      const ageMs = dateAddedMs ? Date.now() - dateAddedMs : Number.POSITIVE_INFINITY;
      const isFresh = ageMs <= THIRTY_DAYS_MS;
      const targetFolder = isFresh ? FOLDERS.LEADS_FRESH : FOLDERS.LEADS_GENERAL;

      const payload = {
        first_name: first,
        last_name: last,
        phone,
        email,
        address1: street,
        city,
        state,
        zip,
        category_id: targetFolder,
        // The earlier (working) integration stores the Pocomos URL as a
        // SECOND custom_field named "Pocomos Profile" — there is no top-level
        // `website` field that PB honors. See REFERENCE.md §4.
        custom_fields: [
          { name: "Customer ID", type: 1, value: leadId },
          { name: "Pocomos Profile", type: 1, value: pocomosUrl },
        ],
        notes: notesBlock,
      };

      if (opts.dryRun) {
        result.dry_run_preview!.push({
          lead_id: leadId,
          payload: payload as Record<string, unknown>,
          notes_block: notesBlock,
        });
        advanceWatermark();
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
            ${leadId}, 'lead', ${pbId}, ${targetFolder},
            NOW(), NOW(), NOW()
          )
          ON CONFLICT (pocomos_id) DO UPDATE
            SET pb_contact_id = EXCLUDED.pb_contact_id,
                folder_id = EXCLUDED.folder_id,
                last_updated_at = NOW(),
                last_notes_refresh_at = NOW()
        `;
        alreadySynced.add(leadId);
        existingPbPhones.add(phone);
        result.added += 1;
        advanceWatermark();
      } catch (e) {
        // Don't advance the watermark — we want to retry this lead next tick.
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
