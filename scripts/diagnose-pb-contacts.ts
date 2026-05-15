/**
 * Diagnose where contacts in `phoneburner_contacts` (Neon) actually live in
 * PhoneBurner. Cross-checks our local folder_id record against what PB says
 * the contact's category_id actually is, and counts contacts per folder PB-side.
 *
 * Run:
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/diagnose-pb-contacts.ts
 */
import { sql } from "../src/lib/db";
import { listFolders, getContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

interface FolderCount {
  folder_id: string;
  count: number;
}

(async () => {
  console.log("=== Step 1 — Neon: contact counts per folder_id ===\n");
  const dbCounts = (await sql`
    SELECT folder_id, COUNT(*)::int AS count
      FROM phoneburner_contacts
     GROUP BY folder_id
     ORDER BY count DESC
  `) as FolderCount[];
  if (dbCounts.length === 0) {
    console.log("(empty table)\n");
  } else {
    for (const r of dbCounts) {
      const friendly = Object.entries(FOLDERS).find(([, v]) => v === r.folder_id)?.[0] ?? "(unknown)";
      console.log(`  ${r.folder_id}  ${friendly.padEnd(22)}  count=${r.count}`);
    }
    console.log("");
  }

  console.log("=== Step 2 — Pick one row, look it up in PhoneBurner ===\n");
  const sampleRows = (await sql`
    SELECT pocomos_id, pb_contact_id, folder_id, synced_at
      FROM phoneburner_contacts
     ORDER BY synced_at DESC
     LIMIT 5
  `) as Array<{
    pocomos_id: string;
    pb_contact_id: string;
    folder_id: string;
    synced_at: string;
  }>;

  if (sampleRows.length === 0) {
    console.log("(no rows to sample)\n");
  } else {
    for (const row of sampleRows) {
      console.log(`pocomos_id=${row.pocomos_id} pb_contact_id=${row.pb_contact_id} db_folder=${row.folder_id}`);
      try {
        const pb = await getContact(row.pb_contact_id);
        if (!pb) {
          console.log(`  ⚠️  PB returned null — contact does NOT exist in PhoneBurner`);
        } else {
          const pbFolder = pb.category_id != null ? String(pb.category_id) : "(none)";
          const match = pbFolder === String(row.folder_id);
          console.log(`  PB.category_id = ${pbFolder}  ${match ? "✓ matches DB" : "✗ MISMATCH"}`);
          console.log(`  PB.first_name=${pb.first_name ?? "(none)"} PB.last_name=${pb.last_name ?? "(none)"} PB.raw_phone=${pb.raw_phone ?? "(none)"}`);
        }
      } catch (e) {
        console.log(`  ⚠️  PB lookup errored: ${(e as Error).message}`);
      }
      console.log("");
    }
  }

  console.log("=== Step 3 — All PhoneBurner folders + names ===\n");
  try {
    const folders = await listFolders();
    if (folders.length === 0) {
      console.log("(listFolders returned [])\n");
    } else {
      for (const f of folders) {
        const id = String(f.category_id);
        const name = f.category_name ?? f.name ?? "(no name)";
        const friendly = Object.entries(FOLDERS).find(([, v]) => v === id)?.[0] ?? "";
        console.log(`  ${id.padEnd(10)} ${name}  ${friendly ? `(constant: ${friendly})` : ""}`);
      }
    }
  } catch (e) {
    console.log(`listFolders errored: ${(e as Error).message}`);
  }

  console.log("\n=== Step 4 — Folder name lookup table for the IDs in our DB ===\n");
  const folders = await listFolders().catch(() => []);
  const folderById = new Map<string, string>();
  for (const f of folders) {
    folderById.set(String(f.category_id), f.category_name ?? f.name ?? "(no name)");
  }
  for (const r of dbCounts) {
    console.log(`  ${r.folder_id}  count=${r.count}  PB-reported-name=${folderById.get(r.folder_id) ?? "⚠️ NOT FOUND IN PB folder list"}`);
  }
  console.log("\n=== done ===");
})().catch((e) => {
  console.error("diagnose failed:", e);
  process.exitCode = 1;
});
