/**
 * READ-ONLY check for TV-TECHS: compute the board off the live caches and prove
 * the product rules hold (Cesar excluded, every working tech gets an award).
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-tv-techs.ts
 */
import { getTechBoard, isExcludedTech } from "../src/lib/service/tech-board";

(async () => {
  const b = await getTechBoard();
  console.log(`board week: ${b.weekStart} .. ${b.weekEnd}  year=${b.year} stale=${b.stale}`);

  console.log(`\n--- winners (${b.winners.length}) ---`);
  for (const w of b.winners) {
    console.log(`  ${w.award.emoji} ${w.award.label.padEnd(14)} ${w.technician.padEnd(22)} ${w.stat}`);
  }

  console.log(`\n--- this-week table ---`);
  for (const r of b.table) {
    console.log(`  ${r.technician.padEnd(22)} sprays=${String(r.sprays).padStart(4)} rate=${r.rate.toFixed(1)}%`);
  }

  console.log(`\n--- YTD ticker ---`);
  console.log(`  ${b.ytd.sprays} sprays · ${b.ytd.resprays} resprays · ${b.ytd.rate.toFixed(2)}%`);
  console.log(`  longest clean streak: ${b.ytd.longestCleanStreakTech} @ ${b.ytd.longestCleanStreak}`);

  // ---- assertions ----
  const fails: string[] = [];
  const winnerNames = new Set(b.winners.map((w) => w.technician));

  for (const r of b.table) {
    if (isExcludedTech(r.technician)) fails.push(`EXCLUDED tech on table: ${r.technician}`);
    if (!winnerNames.has(r.technician)) fails.push(`no award for working tech: ${r.technician}`);
  }
  for (const w of b.winners) {
    if (isExcludedTech(w.technician)) fails.push(`EXCLUDED tech won an award: ${w.technician}`);
  }
  if (/cesar/i.test(JSON.stringify(b))) fails.push("Cesar appears somewhere in the board payload");

  console.log(`\n=== ${fails.length === 0 ? "ALL RULES PASS" : "FAILURES"} ===`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
