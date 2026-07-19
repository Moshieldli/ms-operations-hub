/**
 * rev 38 recomputation report: respray window + maturity + two clocks +
 * exclusion-from-awards-only. READ-ONLY.
 */
import { getRespraysReport, maturedWeekStart, weekStart, RESPRAY_WINDOW_DAYS } from "../src/lib/service/resprays";
import { getTechBoard } from "../src/lib/service/tech-board";
import { boardWeekStart } from "../src/lib/service/tech-board";

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`today ${today}`);
  console.log(`VOLUME clock  (last completed Sun-Fri): ${boardWeekStart(today)}`);
  console.log(`MATURED clock (all sprays >=9d old):    ${maturedWeekStart(today)}`);

  const r = await getRespraysReport();
  const t = r.totals;
  console.log(`\n=== TOTALS (window ${RESPRAY_WINDOW_DAYS}d) ===`);
  console.log(`  re-service jobs      ${t.reserviceJobs}`);
  console.log(`  attributed resprays  ${t.countedResprays}  (chains ${t.chainResprays})`);
  console.log(`  outside window       ${t.anomalyResprays}`);
  console.log(`  unattributed         ${t.unattributed}`);
  console.log(`  applications YTD     ${t.applications}`);
  console.log(`  team rate            ${t.teamRate.toFixed(2)}%`);
  console.log(`  check: ${t.countedResprays}+${t.anomalyResprays}+${t.unattributed} = ${t.countedResprays+t.anomalyResprays+t.unattributed} vs ${t.reserviceJobs}`);

  if (r.seasonPace) {
    const p = r.seasonPace;
    console.log(`\n=== SEASON PACE ===\n  ${p.sprays} vs ${p.priorSprays} by ${p.asOfDate} last year (${p.deltaPct>=0?"+":""}${p.deltaPct}%)`);
  }

  console.log(`\n=== PER-TECH (YTD, everyone) ===`);
  console.log("  tech".padEnd(26) + "apps  resp   rate");
  for (const x of r.techs) {
    console.log(`  ${x.technician.padEnd(24)}${String(x.applications).padStart(4)}${String(x.resprays).padStart(6)}  ${x.rate.toFixed(2)}%${x.flagged?"  FLAGGED":""}`);
  }

  console.log(`\n=== ANOMALIES (>${RESPRAY_WINDOW_DAYS}d, nobody blamed) — ${r.anomalies.length} ===`);
  for (const a of r.anomalies) {
    console.log(`  ${a.reserviceDate}  gap ${String(a.gapDays).padStart(3)}d  ${a.customerName} (prior ${a.priorJobDate} ${a.priorJobType} by ${a.priorTech}) re-serviced by ${a.reserviceTech}`);
  }

  const b = await getTechBoard();
  console.log(`\n=== TECH BOARD ===`);
  console.log(`  volume week  ${b.weekStart} .. ${b.weekEnd}`);
  console.log(`  matured week ${b.maturedWeekStart} .. ${b.maturedWeekEnd}`);
  console.log(`  YTD ticker: ${b.ytd.sprays} sprays · ${b.ytd.rate.toFixed(2)}% team rate · streak ${b.ytd.longestCleanStreak} (${b.ytd.longestCleanStreakTech})`);
  console.log(`  winners:`);
  for (const w of b.winners) console.log(`    ${w.award.label.padEnd(15)} ${w.technician.padEnd(20)} ${w.stat.padEnd(24)} | ${w.period}`);
  console.log(`  table (all techs, sprays=volume wk, rate=matured wk):`);
  for (const x of b.table) console.log(`    ${x.technician.padEnd(24)} ${String(x.sprays).padStart(4)}  ${x.rate.toFixed(1)}%`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
