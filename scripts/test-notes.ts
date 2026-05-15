/**
 * One-off probe for getNotesForLead — pulls the note history for a Pocomos
 * lead and prints both the raw array and the PhoneBurner-formatted block
 * that leadSync would put in the `notes` field.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/test-notes.ts [leadId]
 */
import { getNotesForLead, formatNotesForPhoneBurner } from "../src/lib/pocomos/notes";

const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";

(async () => {
  const leadId = process.argv[2] || "5913698";
  console.log(`=== getNotesForLead("${leadId}") ===\n`);

  const notes = await getNotesForLead(leadId);

  console.log(`total count: ${notes.length}`);
  console.log(`pocomos source: ${notes.filter((n) => n.source === "pocomos").length}`);
  console.log(`pb source:      ${notes.filter((n) => n.source === "pb").length}\n`);

  console.log("--- raw notes array ---");
  console.log(JSON.stringify(notes, null, 2));

  const url = `${POCOMOS_BASE}/lead/${leadId}/lead-information`;
  const block = formatNotesForPhoneBurner(notes, url);

  console.log("\n--- formatNotesForPhoneBurner output ---");
  console.log(block || "(empty — no pocomos-source notes)");
  console.log("\n=== done ===");
})().catch((e) => {
  console.error("test-notes failed:", e);
  process.exitCode = 1;
});
