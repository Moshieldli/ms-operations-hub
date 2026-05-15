/**
 * Surgical cleanup of broken PhoneBurner contacts created by today's
 * sync runs against the wrong folder ID.
 *
 * Broken-contact signature (verified via probing 2026-05-15):
 *   - date_added today (UTC)
 *   - category.category_id == "47718" (PB's default catch-all, which is
 *     where contacts land when the requested category_id is invalid —
 *     our `3275950` doesn't exist)
 *   - phone is empty (we sent `raw_phone` but PB needs `phone`; the field
 *     was silently dropped)
 *
 * Healthy May 4 + May 14 contacts from PRIOR working integration runs
 * have category_ids 66229452 / 66223884 / etc. and full phone+email data.
 * They are explicitly EXCLUDED.
 *
 * Plus: a handful of test contacts created during today's probe sessions
 * landed in folder 66223880 (real Fresh) with `last_name = 'DELETE_ME'` —
 * those are also targeted by user_id from the explicit allowlist below.
 *
 * Run dry-run (default):
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/cleanup-bad-pb-contacts.ts
 *
 * Run for real:
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/cleanup-bad-pb-contacts.ts --confirm
 */
import { sql } from "../src/lib/db";
import { deleteContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

const CONFIRM = process.argv.includes("--confirm");
const TODAY_UTC = new Date().toISOString().slice(0, 10);

// Test contacts I created during probe-shape testing today, which landed in
// real Fresh (66223880) so the main filter won't catch them.
const EXPLICIT_TEST_IDS = ["1281442709", "1281442710", "1281442719"];

interface CandidateRow {
  user_id: string;
  first_name?: string;
  last_name?: string;
  date_added?: string;
  category_id?: string;
  raw_phone?: string;
  reason: string;
}

(async () => {
  console.log(`Cleanup mode: ${CONFIRM ? "✗ CONFIRM (will delete)" : "✓ DRY-RUN (no writes)"}`);
  console.log(`Filter: category.category_id = ${FOLDERS.DEFAULT_CONTACTS} AND date_added LIKE "${TODAY_UTC}%"`);
  console.log(`Plus explicit test ids: ${EXPLICIT_TEST_IDS.join(", ")}\n`);

  const tok = process.env.PHONEBURNER_TOKEN;
  if (!tok) throw new Error("PHONEBURNER_TOKEN must be set");

  const candidates: CandidateRow[] = [];
  let totalScanned = 0;
  let healthyKeptToday = 0;

  console.log(`Scanning folder ${FOLDERS.DEFAULT_CONTACTS} (master view)...`);
  let page = 1;
  for (;;) {
    const url = `https://www.phoneburner.com/rest/1/contacts?folder_id=${FOLDERS.DEFAULT_CONTACTS}&page=${page}&page_size=200`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });
    const j = (await r.json()) as { contacts?: { contacts?: Array<Record<string, unknown>>; total_pages?: number } };
    const rows = j.contacts?.contacts ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      totalScanned += 1;
      const dateAdded = String(row.date_added ?? "");
      const day = dateAdded.slice(0, 10);
      if (day !== TODAY_UTC) continue;
      // Each row from the list endpoint includes `category` shallowly OR
      // `category_id` at the top level — handle both.
      const cat = (row.category as { category_id?: string } | undefined)?.category_id ?? (row as { category_id?: string }).category_id;
      const phone = String(row.raw_phone ?? "");
      if (cat === FOLDERS.DEFAULT_CONTACTS) {
        candidates.push({
          user_id: String(row.user_id ?? ""),
          first_name: typeof row.first_name === "string" ? row.first_name : undefined,
          last_name: typeof row.last_name === "string" ? row.last_name : undefined,
          date_added: dateAdded,
          category_id: cat,
          raw_phone: phone,
          reason: phone ? "today + cat=47718 (test contact)" : "today + cat=47718 + empty phone (broken sync)",
        });
      } else {
        // Today, but in a real folder — KEEP.
        healthyKeptToday += 1;
      }
    }
    const totalPages = j.contacts?.total_pages ?? 0;
    if (totalPages && page >= totalPages) break;
    if (rows.length < 200) break;
    page += 1;
    if (page > 1000) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Add the explicit test ids from probe-shape testing (in folder 66223880).
  for (const uid of EXPLICIT_TEST_IDS) {
    if (candidates.some((c) => c.user_id === uid)) continue;
    candidates.push({
      user_id: uid,
      reason: "explicit allowlist (probe-shape test in folder 66223880)",
    });
  }

  console.log(`Total contacts scanned: ${totalScanned}`);
  console.log(`Today + cat=47718 (BROKEN, will delete): ${candidates.length - EXPLICIT_TEST_IDS.length}`);
  console.log(`Today + healthy folder (KEPT):           ${healthyKeptToday}`);
  console.log(`Explicit test ids in real Fresh folder:  ${EXPLICIT_TEST_IDS.length}`);
  console.log(`Total to delete: ${candidates.length}\n`);

  console.log(`Sample (first 8):`);
  for (const c of candidates.slice(0, 8)) {
    console.log(`  user_id=${c.user_id.padEnd(12)} ${c.first_name ?? "?"} ${c.last_name ?? "?"}  cat=${c.category_id ?? "?"}  date=${c.date_added ?? "?"}`);
    console.log(`    reason: ${c.reason}`);
  }

  // Sanity guard
  if (candidates.length > 5000) {
    console.error(`\n✗ refusing: ${candidates.length} candidates is more than expected, abort to investigate`);
    process.exitCode = 1;
    return;
  }

  if (!CONFIRM) {
    console.log(`\n=== DRY-RUN — no deletions performed ===`);
    console.log(`To delete ${candidates.length} contacts + truncate Neon, re-run with --confirm`);
    return;
  }

  console.log(`\n=== DELETING ${candidates.length} contacts from PhoneBurner ===`);
  let deleted = 0;
  let deleteErrors = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      await deleteContact(c.user_id);
      deleted += 1;
    } catch (e) {
      deleteErrors += 1;
      const msg = (e as Error).message.slice(0, 100);
      // 404 is fine — already gone.
      if (!/failed: 404/.test(msg)) {
        console.warn(`  ✗ delete ${c.user_id} failed: ${msg}`);
      } else {
        deleted += 1;
      }
    }
    if ((i + 1) % 100 === 0) console.log(`  progress: ${i + 1}/${candidates.length}  deleted=${deleted} errors=${deleteErrors}`);
  }
  console.log(`PB deletes: ${deleted} ok, ${deleteErrors} errored`);

  console.log(`\n=== TRUNCATING phoneburner_contacts ===`);
  const before = (await sql`SELECT COUNT(*)::int AS n FROM phoneburner_contacts`) as Array<{ n: number }>;
  console.log(`Rows before truncate: ${before[0]?.n ?? 0}`);
  await sql`TRUNCATE TABLE phoneburner_contacts`;
  const after = (await sql`SELECT COUNT(*)::int AS n FROM phoneburner_contacts`) as Array<{ n: number }>;
  console.log(`Rows after truncate:  ${after[0]?.n ?? 0}`);

  console.log(`\n=== Resetting sync_state.phoneburner_last_sync_at ===`);
  await sql`DELETE FROM sync_state WHERE key = 'phoneburner_last_sync_at'`;
  console.log(`Watermark cleared.`);

  console.log(`\n=== Cleanup complete ===`);
})().catch((e) => {
  console.error("cleanup failed:", e);
  process.exitCode = 1;
});
