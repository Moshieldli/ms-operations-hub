/**
 * Local dry-run for the PhoneBurner lead sync. Pulls real Pocomos lead data
 * via the web back-door, runs the full transform pipeline (dedup against
 * Neon, format notes), and prints what *would* be POSTed to PhoneBurner —
 * but never actually writes to PhoneBurner or to Neon.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/test-sync.ts
 *
 * Env knobs:
 *   TEST_LIMIT  — number of leads to consider (default 5)
 */
import { runLeadSync } from "../src/lib/sync/leadSync";

(async () => {
  const limit = Number(process.env.TEST_LIMIT || 5);
  console.log(`=== leadSync DRY_RUN (limit=${limit}) ===\n`);

  const result = await runLeadSync({ limit, dryRun: true });

  console.log(`watermark_before: ${result.watermark_before ?? "(none)"}`);
  console.log(`watermark_after:  ${result.watermark_after ?? "(unchanged)"}`);
  console.log(`pages_fetched:    ${result.pages_fetched}`);
  console.log(`would_add:        ${result.dry_run_preview?.length ?? 0}`);
  console.log(`skipped_dup:      ${result.skipped_dup}`);
  console.log(`skipped_nophone:  ${result.skipped_nophone}`);
  console.log(`errors:           ${result.errors.length}`);
  console.log(`duration_ms:      ${result.duration_ms}\n`);

  for (const preview of result.dry_run_preview || []) {
    console.log(`--- lead ${preview.lead_id} ---`);
    const { notes, ...payloadSansNotes } = preview.payload as Record<string, unknown>;
    console.log("payload (notes shown separately):");
    console.log(JSON.stringify(payloadSansNotes, null, 2));
    console.log("notes block:");
    console.log(preview.notes_block || "(empty)");
    console.log("");
    void notes;
  }

  if (result.errors.length) {
    console.log("\n=== errors ===");
    for (const e of result.errors) {
      console.log(`  ${e.pocomos_id}: ${e.error}`);
    }
  }

  console.log("\n=== done ===");
})().catch((e) => {
  console.error("test-sync failed:", e);
  process.exitCode = 1;
});
