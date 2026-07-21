/**
 * Wellness feeder driver — DRY RUN by default; pass --live to actually push.
 *
 *   $env:PHONEBURNER_TOKEN='...'; node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-wellness-feed.ts [--live]
 *
 * Dry run reads PhoneBurner + Pocomos + Neon and writes NOTHING. Live pushes
 * eligible customers into "Wellness — Queue" and upserts phoneburner_contacts.
 */
import { runWellnessFeed } from "../src/lib/sync/wellnessFeed";

(async () => {
  const live = process.argv.includes("--live");
  const r = await runWellnessFeed({ dryRun: !live });

  console.log(`\n================ WELLNESS FEED ${live ? "LIVE" : "DRY RUN"} ================`);
  console.log(`  season ${r.season} · roster active ${r.rosterActive} · 2+ sprays ${r.twoPlus}`);
  console.log(
    `  excluded: alreadyCalled ${r.alreadyCalled} · notActive ${r.notActive} · paused ${r.pausedSkipped} · noPhone ${r.noPhone} · alreadyQueued ${r.alreadyQueued}`
  );
  console.log(`  queue size ${r.queueSize} · reconciled ${r.reconciled}`);
  console.log(`  wouldPush ${r.wouldPush} · pushed ${r.pushed} · errors ${r.errors.length} · ${r.duration_ms}ms`);

  console.log(`\n  first 20 of the ${live ? "push" : "would-push"} list (sprays desc):`);
  for (const c of r.pushList.slice(0, 20)) {
    console.log(
      `    ${c.pocomos_id}  ${String(c.sprays).padStart(2)} sprays${c.is_weekly ? " [weekly]" : ""}  last ${c.last_spray ?? "?"}  signed ${c.sign_up ?? "?"}  ${c.name}  (${c.phone})`
    );
  }

  // Review aid: the sprays-desc top is dominated by weekly-cadence customers,
  // so also show a RANDOM sample of the bi-weekly (non-weekly) majority.
  const biweekly = r.pushList.filter((c) => !c.is_weekly);
  const shuffled = [...biweekly].sort(() => Math.random() - 0.5);
  console.log(`\n  random 20 of the ${biweekly.length} BI-WEEKLY customers in the list:`);
  for (const c of shuffled.slice(0, 20)) {
    console.log(
      `    ${c.pocomos_id}  ${String(c.sprays).padStart(2)} sprays  last ${c.last_spray ?? "?"}  signed ${c.sign_up ?? "?"}  ${c.name}  (${c.phone})`
    );
  }
  if (r.errors.length) {
    console.log("\n  errors:");
    for (const e of r.errors.slice(0, 20)) console.log(`    ${e.pocomos_id}: ${e.error}`);
  }
  console.log("\nDONE");
})();
