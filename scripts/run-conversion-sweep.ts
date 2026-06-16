/**
 * Drive the conversion sweep: DRY RUN first (no writes), verify Igor's two
 * contacts are in the would-move set, then GO LIVE (moves are reversible —
 * a folder change in PhoneBurner), then confirm both Igor contacts landed in
 * the Active Customer folder (66233602).
 *
 * READ-ONLY against Pocomos. Writes ONLY to PhoneBurner (folder moves) + Neon.
 *
 * Run (PB token is Production-only; pass it inline):
 *   $env:PHONEBURNER_TOKEN='...'; node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-conversion-sweep.ts
 */
import { runConversionSweep } from "../src/lib/sync/conversionSweep";
import { getContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

// Igor Lipkin's two policed contacts (from probe-pb-folders.ts):
//   General (66223881)          -> frozen lead 5505704
//   Cancelled-Personal (66223888) -> customer 198709
const IGOR_GENERAL = "1281332879";
const IGOR_CANCELLED = "1281377957";

function counts(r: Awaited<ReturnType<typeof runConversionSweep>>) {
  return {
    scanned: r.scanned,
    matchedById: r.matchedById,
    matchedByPhone: r.matchedByPhone,
    nameMismatchSkipped: r.nameMismatchSkipped,
    noMatch: r.noMatch,
    wouldMove: r.wouldMove,
    moved: r.moved,
    rosterActiveCount: r.rosterActiveCount,
    duration_ms: r.duration_ms,
    errors: r.errors.length,
  };
}

(async () => {
  console.log("================ DRY RUN ================");
  const dry = await runConversionSweep({ dryRun: true, trackPbIds: [IGOR_GENERAL, IGOR_CANCELLED] });
  console.log(JSON.stringify(counts(dry), null, 2));
  console.log("\nPer-folder:");
  for (const [f, v] of Object.entries(dry.perFolder)) {
    console.log(`  ${f}: scanned ${v.scanned}, matched ${v.matched}`);
  }
  console.log(`\nName-mismatch reviews (${dry.reviews.length}):`);
  for (const rv of dry.reviews) {
    console.log(
      `  [${rv.folder_id}] pb=${rv.pb_contact_id} "${rv.name}" phone=${rv.phone} ` +
        `roster_last=${rv.roster_last_name} roster_cust=${rv.roster_customer_id}`
    );
  }

  console.log("\n--- Igor would-move verification ---");
  for (const t of dry.tracked) {
    console.log(
      `  pb=${t.pb_contact_id} [${t.folder_id}] "${t.name}" storedCustId=${t.stored_customer_id} ` +
        `phone=${t.phone} kind=${t.kind} resolved=${t.resolved_customer_id} wouldMove=${t.would_move}`
    );
  }
  const igorIds = new Set(dry.tracked.filter((t) => t.would_move).map((t) => t.pb_contact_id));
  const bothInWouldMove = igorIds.has(IGOR_GENERAL) && igorIds.has(IGOR_CANCELLED);
  console.log(
    `\n>>> Igor General(${IGOR_GENERAL}) + Cancelled-Personal(${IGOR_CANCELLED}) ` +
      `BOTH in would-move set? ${bothInWouldMove}`
  );
  if (!bothInWouldMove) {
    console.log("ABORTING live run — Igor not fully matched in dry run. Investigate first.");
    process.exit(1);
  }

  console.log("\n================ LIVE RUN ================");
  const live = await runConversionSweep({ dryRun: false, trackPbIds: [IGOR_GENERAL, IGOR_CANCELLED] });
  console.log(JSON.stringify(counts(live), null, 2));
  if (live.errors.length) {
    console.log("Live errors:");
    for (const e of live.errors) console.log(`  pb=${e.pb_contact_id}: ${e.error}`);
  }

  console.log("\n--- Igor final-folder verification (expect 66233602 for both) ---");
  for (const [label, id] of [
    ["General-origin lead 5505704", IGOR_GENERAL],
    ["Cancelled-Personal customer 198709", IGOR_CANCELLED],
  ] as const) {
    const c = await getContact(id);
    const cat = c?.category_id ?? "(none)";
    const ok = cat === FOLDERS.ACTIVE_CUSTOMER;
    console.log(`  ${label}: pb=${id} now in folder ${cat} ${ok ? "OK" : "!! NOT in Active Customer"}`);
  }

  console.log("\nDONE");
})();
