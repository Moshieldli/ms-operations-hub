/**
 * Probe the two wellness-campaign PhoneBurner folders (created manually in the
 * PB UI) and print their folder IDs, for wiring into src/lib/phoneburner/folders.ts.
 *
 *   Wellness — Queue 2026    (the dial queue Rena works)
 *   Wellness — Called 2026   (one attempt of any kind moves the contact here)
 *
 * Uses GET /folders — NOT /contacts/categories (that path 404s; see
 * docs/REFERENCE.md §4). READ-ONLY.
 *
 * Run (PB token is Production-only; pass it inline):
 *   $env:PHONEBURNER_TOKEN='...'; node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-wellness-folders.ts
 */
import { listFolders } from "../src/lib/phoneburner/client";

/** Normalize a folder name for matching: lowercase, unify dash variants, collapse spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−-]+/g, "-") // any dash/hyphen/em-dash → "-"
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const folders = await listFolders();
  console.log(`GET /folders → ${folders.length} folders\n`);
  for (const f of folders) {
    console.log(`  ${String(f.folder_id).padEnd(10)} ${f.folder_name ?? "(unnamed)"}`);
  }

  const year = new Date().getFullYear();
  const wellness = folders.filter((f) => norm(f.folder_name ?? "").includes("wellness"));
  const queue = wellness.find((f) => norm(f.folder_name ?? "").includes("queue"));
  const called = wellness.find((f) => norm(f.folder_name ?? "").includes("called"));

  console.log("\n---- wellness folders ----");
  console.log(`Queue : ${queue ? `${queue.folder_id}  "${queue.folder_name}"` : "NOT FOUND"}`);
  console.log(`Called: ${called ? `${called.folder_id}  "${called.folder_name}"` : "NOT FOUND"}`);

  for (const f of [queue, called]) {
    if (f && !norm(f.folder_name ?? "").includes(String(year))) {
      console.log(`⚠ folder "${f.folder_name}" does not carry the current year (${year})`);
    }
  }
  if (!queue || !called) {
    console.log("\nOne or both folders missing — create them in the PhoneBurner UI first.");
    process.exit(1);
  }
})();
