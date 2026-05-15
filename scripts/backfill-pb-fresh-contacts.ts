/**
 * Backfill the 6 PhoneBurner contacts currently in real Fresh (66223880)
 * that were created by today's broken-but-not-broken-enough sync runs.
 * Two problems to fix per contact:
 *
 *   1. Pocomos URL is missing — was sent as `website` body field which PB
 *      silently dropped. The earlier working integration stores the URL
 *      as a SECOND custom_field named "Pocomos Profile".
 *
 *   2. Folder assignment ignores the lead's age. Per the 30-day rule:
 *      lead.date_added within 30 days → Fresh (66223880)
 *      lead.date_added older → General (66223881)
 *
 * Plan:
 *   1. List all contacts where category.category_id = LEADS_FRESH.
 *      (`?category_id=N` actually filters; `?folder_id=N` is silently ignored.)
 *   2. For each, extract the Customer ID custom_field (Pocomos lead_id).
 *   3. Look up the lead's date_added via Pocomos `/leads/data` web back-door.
 *      Pulled in batched pages so we hit the endpoint at most ~30 times for
 *      the whole office, not once per contact.
 *   4. Compute target folder per 30-day rule. If folder needs to change OR
 *      Pocomos Profile custom_field is missing → PUT the contact with the
 *      new category_id + both custom_fields (Customer ID + Pocomos Profile).
 *   5. Update phoneburner_contacts.folder_id in Neon to match.
 *
 * Run dry-run (default):
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-pb-fresh-contacts.ts
 *
 * Run for real:
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-pb-fresh-contacts.ts --confirm
 */
import { sql } from "../src/lib/db";
import { listContactsInFolder, updateContact, getContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";
import { postSessioned } from "../src/lib/pocomos/webSession";

const CONFIRM = process.argv.includes("--confirm");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";
const PAGE_SIZE = 100;

interface LeadRow {
  id?: string | number;
  date_added?: string;
}

interface LeadsDataResponse {
  aaData?: LeadRow[];
  data?: LeadRow[];
  iTotalRecords?: number;
}

interface FreshContact {
  user_id: string;
  customer_id: string;
  has_pocomos_profile: boolean;
}

async function fetchLeadsPage(start: number): Promise<LeadRow[]> {
  const body = new URLSearchParams();
  body.set("draw", "1");
  body.set("sEcho", "1");
  body.set("start", String(start));
  body.set("length", String(PAGE_SIZE));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  body.append("statuses[]", "Lead");
  body.append("statuses[]", "Not Home");
  body.append("statuses[]", "Not Interested");
  body.append("statuses[]", "Monitor");
  body.set("search[value]", "");
  body.set("search[regex]", "false");
  body.set("order[0][column]", "0");
  body.set("order[0][dir]", "desc");
  const r = await postSessioned<LeadsDataResponse>("/leads/data", body, { referer: "/leads" });
  return r.aaData ?? r.data ?? [];
}

/**
 * Pull Pocomos lead `date_added` for every lead we need. Stops as soon as
 * all target ids are found. Worst case: paginates the full lead list.
 */
async function buildLeadDateMap(targetIds: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let start = 0;
  while (out.size < targetIds.size && start < 50_000) {
    const rows = await fetchLeadsPage(start);
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = row.id != null ? String(row.id) : "";
      if (!id) continue;
      if (targetIds.has(id) && !out.has(id) && row.date_added) {
        out.set(id, row.date_added);
      }
    }
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return out;
}

(async () => {
  console.log(`Backfill mode: ${CONFIRM ? "✗ CONFIRM (will write)" : "✓ DRY-RUN (no writes)"}\n`);

  // ── Step 1: list every contact in real Fresh (using the FIXED filter) ──
  console.log(`Scanning category_id=${FOLDERS.LEADS_FRESH} (Fresh)...`);
  const freshContacts: FreshContact[] = [];
  let scanned = 0;
  for await (const c of listContactsInFolder(FOLDERS.LEADS_FRESH)) {
    scanned += 1;
    if (!c.user_id) continue;
    const cfs = c.custom_fields ?? [];
    const customerIdField = cfs.find((f) => f.name === "Customer ID");
    const pocomosProfileField = cfs.find((f) => f.name === "Pocomos Profile");
    freshContacts.push({
      user_id: c.user_id,
      customer_id: customerIdField?.value ?? "",
      has_pocomos_profile: !!pocomosProfileField?.value,
    });
  }
  console.log(`Found ${scanned} contacts in Fresh.\n`);

  if (freshContacts.length === 0) {
    console.log("Nothing to backfill — Fresh is empty.");
    return;
  }

  console.log("Contacts found:");
  for (const c of freshContacts) {
    console.log(`  pb_uid=${c.user_id}  customer_id=${c.customer_id || "(missing)"}  has_pocomos_profile=${c.has_pocomos_profile}`);
  }

  // ── Step 2: look up each lead's date_added in Pocomos ──
  const targetIds = new Set(freshContacts.map((c) => c.customer_id).filter((id) => id));
  console.log(`\nFetching Pocomos date_added for ${targetIds.size} lead ids...`);
  const dateMap = await buildLeadDateMap(targetIds);
  console.log(`Resolved ${dateMap.size}/${targetIds.size} lead dates.`);
  const missing = [...targetIds].filter((id) => !dateMap.has(id));
  if (missing.length) console.log(`  (could not find: ${missing.join(", ")})`);

  // ── Step 3: classify each contact → target folder ──
  const now = Date.now();
  interface Plan {
    pb_uid: string;
    customer_id: string;
    lead_date_added: string;
    age_days: number;
    target_folder: string;
    needs_folder_move: boolean;
    needs_pocomos_profile: boolean;
    pocomos_url: string;
  }
  const plans: Plan[] = [];
  for (const c of freshContacts) {
    const leadDate = dateMap.get(c.customer_id) ?? "";
    const leadMs = leadDate ? Date.parse(leadDate) : 0;
    const ageMs = leadMs ? now - leadMs : Number.POSITIVE_INFINITY;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const target = ageMs <= THIRTY_DAYS_MS ? FOLDERS.LEADS_FRESH : FOLDERS.LEADS_GENERAL;
    plans.push({
      pb_uid: c.user_id,
      customer_id: c.customer_id,
      lead_date_added: leadDate || "(unknown)",
      age_days: Math.round(ageDays),
      target_folder: target,
      needs_folder_move: target !== FOLDERS.LEADS_FRESH,
      needs_pocomos_profile: !c.has_pocomos_profile,
      pocomos_url: c.customer_id ? `${POCOMOS_BASE}/lead/${c.customer_id}/lead-information` : "",
    });
  }

  console.log(`\nPlanned changes:`);
  console.log(`  ${"pb_uid".padEnd(12)}  ${"customer".padEnd(10)}  ${"lead_date".padEnd(20)}  ${"age".padEnd(7)}  target  +profile  +move`);
  for (const p of plans) {
    const targetName = p.target_folder === FOLDERS.LEADS_FRESH ? "Fresh" : "General";
    console.log(
      `  ${p.pb_uid.padEnd(12)}  ${p.customer_id.padEnd(10)}  ${p.lead_date_added.padEnd(20)}  ${String(p.age_days).padEnd(7)}  ${targetName.padEnd(7)}  ${p.needs_pocomos_profile ? "Y" : "."}        ${p.needs_folder_move ? "Y" : "."}`
    );
  }

  const moveCount = plans.filter((p) => p.needs_folder_move).length;
  const profileCount = plans.filter((p) => p.needs_pocomos_profile).length;
  console.log(`\nWould move folder: ${moveCount}`);
  console.log(`Would add Pocomos Profile custom_field: ${profileCount}`);
  console.log(`No-op (already correct): ${plans.filter((p) => !p.needs_folder_move && !p.needs_pocomos_profile).length}`);

  if (!CONFIRM) {
    console.log(`\n=== DRY-RUN — no writes performed ===`);
    console.log(`Re-run with --confirm to apply changes.`);
    return;
  }

  // ── Step 4: apply changes ──
  console.log(`\n=== APPLYING CHANGES ===`);
  let okCount = 0;
  let errCount = 0;
  for (const p of plans) {
    if (!p.needs_folder_move && !p.needs_pocomos_profile) continue;
    try {
      // We have to re-send BOTH custom_fields because the PB update endpoint
      // replaces the custom_fields array wholesale on PUT (not merge). Fetch
      // existing first to preserve anything we don't know about.
      const existing = await getContact(p.pb_uid);
      const existingCfs = existing?.custom_fields ?? [];
      const next: Array<{ name: string; value: string; type?: number }> = [];
      let sawCustomerId = false;
      let sawPocomosProfile = false;
      for (const cf of existingCfs) {
        if (cf.name === "Customer ID") {
          sawCustomerId = true;
          next.push({ name: cf.name, type: cf.type ?? 1, value: cf.value });
        } else if (cf.name === "Pocomos Profile") {
          sawPocomosProfile = true;
          // Always rewrite, since this is the field we're backfilling.
          next.push({ name: cf.name, type: cf.type ?? 1, value: p.pocomos_url });
        } else {
          next.push({ name: cf.name, type: cf.type ?? 1, value: cf.value });
        }
      }
      if (!sawCustomerId && p.customer_id) {
        next.push({ name: "Customer ID", type: 1, value: p.customer_id });
      }
      if (!sawPocomosProfile && p.pocomos_url) {
        next.push({ name: "Pocomos Profile", type: 1, value: p.pocomos_url });
      }

      await updateContact(p.pb_uid, {
        category_id: p.target_folder,
        custom_fields: next,
      });

      // Sync Neon folder_id row if a tracking record exists.
      if (p.customer_id) {
        await sql`
          UPDATE phoneburner_contacts
             SET folder_id = ${p.target_folder},
                 last_updated_at = NOW()
           WHERE pocomos_id = ${p.customer_id}
        `;
      }
      okCount += 1;
      console.log(`  ✓ ${p.pb_uid} → ${p.target_folder} (${p.needs_pocomos_profile ? "added profile, " : ""}${p.needs_folder_move ? "moved" : "no folder change"})`);
    } catch (e) {
      errCount += 1;
      console.warn(`  ✗ ${p.pb_uid} failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`\nApplied: ${okCount} ok, ${errCount} errored.`);

  // Verify
  console.log(`\n=== VERIFY: Fresh contents after backfill ===`);
  let after = 0;
  for await (const _ of listContactsInFolder(FOLDERS.LEADS_FRESH)) after += 1;
  console.log(`Fresh now contains: ${after} contacts`);
})().catch((e) => {
  console.error("backfill failed:", e);
  process.exitCode = 1;
});
