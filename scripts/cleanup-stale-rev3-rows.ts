/**
 * One-off cleanup for the 44 `phoneburner_contacts` rows still carrying
 * `folder_id="3275950"` — the bogus rev-3 view_id. Those rows were inserted
 * during the ~8-minute window between yesterday's PB-side cleanup and the
 * cron-disable deploy taking effect.
 *
 * For each row: GET the pb_contact_id in PhoneBurner, then:
 *   (a) NOT FOUND (404 or null)        → DELETE the Neon row
 *   (b) FOUND in folder 47718 (default)→ DELETE the PB contact AND the Neon row
 *   (c) FOUND in any other folder      → UPDATE Neon row's folder_id to PB's actual category_id
 *
 * Run:
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/cleanup-stale-rev3-rows.ts
 *   (dry-run; --confirm to apply)
 */
import { sql } from "../src/lib/db";
import { getContact, deleteContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

const CONFIRM = process.argv.includes("--confirm");
const STALE_FOLDER_ID = "3275950";

interface StaleRow {
  pocomos_id: string;
  pb_contact_id: string;
  folder_id: string;
}

interface Outcome {
  pocomos_id: string;
  pb_contact_id: string;
  outcome: "not_found" | "in_default" | "in_other_folder" | "error";
  detail?: string;
}

(async () => {
  console.log(`Cleanup mode: ${CONFIRM ? "✗ CONFIRM (will write)" : "✓ DRY-RUN (no writes)"}\n`);

  const rows = (await sql`
    SELECT pocomos_id, pb_contact_id, folder_id
      FROM phoneburner_contacts
     WHERE folder_id = ${STALE_FOLDER_ID}
     ORDER BY pocomos_id
  `) as StaleRow[];
  console.log(`Found ${rows.length} stale rows in Neon with folder_id=${STALE_FOLDER_ID}\n`);

  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const outcomes: Outcome[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let pbContact = null;
    try {
      pbContact = row.pb_contact_id ? await getContact(row.pb_contact_id) : null;
    } catch (e) {
      outcomes.push({
        pocomos_id: row.pocomos_id,
        pb_contact_id: row.pb_contact_id,
        outcome: "error",
        detail: (e as Error).message.slice(0, 120),
      });
      continue;
    }

    if (!pbContact || !pbContact.user_id) {
      // Outcome (a): not found → just delete the Neon row
      if (CONFIRM) {
        await sql`DELETE FROM phoneburner_contacts WHERE pocomos_id = ${row.pocomos_id}`;
      }
      outcomes.push({
        pocomos_id: row.pocomos_id,
        pb_contact_id: row.pb_contact_id,
        outcome: "not_found",
      });
    } else if (pbContact.category_id === FOLDERS.DEFAULT_CONTACTS) {
      // Outcome (b): in default catch-all → delete PB contact + Neon row
      if (CONFIRM) {
        try {
          await deleteContact(row.pb_contact_id);
        } catch (e) {
          const msg = (e as Error).message;
          if (!/failed: 404/.test(msg)) {
            outcomes.push({
              pocomos_id: row.pocomos_id,
              pb_contact_id: row.pb_contact_id,
              outcome: "error",
              detail: `pb delete failed: ${msg.slice(0, 100)}`,
            });
            continue;
          }
        }
        await sql`DELETE FROM phoneburner_contacts WHERE pocomos_id = ${row.pocomos_id}`;
      }
      outcomes.push({
        pocomos_id: row.pocomos_id,
        pb_contact_id: row.pb_contact_id,
        outcome: "in_default",
      });
    } else {
      // Outcome (c): in some other folder → reconcile Neon row's folder_id
      const realFolder = pbContact.category_id ?? "";
      if (CONFIRM && realFolder) {
        await sql`
          UPDATE phoneburner_contacts
             SET folder_id = ${realFolder},
                 last_updated_at = NOW()
           WHERE pocomos_id = ${row.pocomos_id}
        `;
      }
      outcomes.push({
        pocomos_id: row.pocomos_id,
        pb_contact_id: row.pb_contact_id,
        outcome: "in_other_folder",
        detail: `pb category_id=${realFolder}`,
      });
    }

    if ((i + 1) % 10 === 0) console.log(`  progress: ${i + 1}/${rows.length}`);
  }

  // Summarize
  const summary = {
    not_found: outcomes.filter((o) => o.outcome === "not_found").length,
    in_default: outcomes.filter((o) => o.outcome === "in_default").length,
    in_other_folder: outcomes.filter((o) => o.outcome === "in_other_folder").length,
    error: outcomes.filter((o) => o.outcome === "error").length,
  };

  console.log(`\n=== Outcome summary ===`);
  console.log(`  (a) not found in PB        → DELETE Neon row only:        ${summary.not_found}`);
  console.log(`  (b) in folder 47718 (default) → DELETE PB + DELETE Neon:   ${summary.in_default}`);
  console.log(`  (c) in other folder        → UPDATE Neon folder_id:        ${summary.in_other_folder}`);
  console.log(`  ⚠️  errored:                                                 ${summary.error}`);

  if (summary.in_other_folder > 0) {
    console.log(`\nBreakdown of (c) target folders:`);
    const byFolder = new Map<string, number>();
    for (const o of outcomes) {
      if (o.outcome !== "in_other_folder") continue;
      const f = (o.detail ?? "").replace("pb category_id=", "");
      byFolder.set(f, (byFolder.get(f) ?? 0) + 1);
    }
    for (const [f, c] of [...byFolder.entries()].sort()) {
      const name = Object.entries(FOLDERS).find(([, v]) => v === f)?.[0] ?? "(unknown)";
      console.log(`  folder_id=${f} (${name}): ${c}`);
    }
  }

  if (summary.error > 0) {
    console.log(`\nErrors:`);
    for (const o of outcomes.filter((o) => o.outcome === "error")) {
      console.log(`  pocomos_id=${o.pocomos_id} pb_uid=${o.pb_contact_id}: ${o.detail}`);
    }
  }

  if (!CONFIRM) {
    console.log(`\n=== DRY-RUN — no writes performed ===`);
    console.log(`Re-run with --confirm to apply.`);
    return;
  }

  // Verify final state
  const stillStale = (await sql`SELECT COUNT(*)::int AS n FROM phoneburner_contacts WHERE folder_id = ${STALE_FOLDER_ID}`) as Array<{ n: number }>;
  console.log(`\n=== Final Neon state ===`);
  console.log(`Rows still with folder_id=${STALE_FOLDER_ID}: ${stillStale[0]?.n ?? "?"}`);
  const breakdown = (await sql`SELECT folder_id, COUNT(*)::int AS n FROM phoneburner_contacts GROUP BY folder_id ORDER BY folder_id`) as Array<{ folder_id: string; n: number }>;
  console.log(`Full table by folder_id:`);
  for (const r of breakdown) {
    const name = Object.entries(FOLDERS).find(([, v]) => v === r.folder_id)?.[0] ?? "(unknown)";
    console.log(`  ${r.folder_id.padEnd(10)} ${name.padEnd(22)} n=${r.n}`);
  }
})().catch((e) => {
  console.error("cleanup failed:", e);
  process.exitCode = 1;
});
