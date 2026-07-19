/**
 * Spray-week tie-out (rev 36) — proves the board's counted sprays equal the
 * Pocomos completed-jobs rows for the same Sun–Fri span, and shows exactly what
 * is excluded and why.
 *
 *   npx tsx scripts/verify-week-tieout.ts [Technician] [weekStartISO]
 *
 * Defaults to Nathaniel and the current board week. READ-ONLY.
 */
import { sql } from "../src/lib/db";
import { boardWeekStart } from "../src/lib/service/tech-board";
import { weekStart, APPLICATION_JOB_TYPES, fetchCompletedJobs } from "../src/lib/service/resprays";
import { isMosquitoServiceType } from "../src/lib/service/mosquito";

const TECH = process.argv[2] || "Nathaniel";
const todayIso = new Date().toISOString().slice(0, 10);
const WEEK = process.argv[3] || boardWeekStart(todayIso);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (iso: string) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];

(async () => {
  const friday = addDays(WEEK, 5);
  const saturday = addDays(WEEK, 6);
  console.log(`today ${todayIso} (${dow(todayIso)}) → board week ${WEEK} (${dow(WEEK)}) .. ${friday} (${dow(friday)})`);
  console.log(`bucket spans ${WEEK}..${saturday} (Saturday structurally empty)\n`);

  /*
   * Pull the RAW Pocomos completed-jobs report, not `respray_jobs`.
   *
   * The cache stores ONLY mosquito-family jobs (resprays.ts: "Store only
   * mosquito-family jobs"), so reconciling against it would compare the cache
   * to itself and could never surface an Add-On Tick / Fly Trap row. The whole
   * point of this tie-out is to show what Pocomos returned and what we dropped.
   */
  const live = await fetchCompletedJobs();
  const rows = live
    .filter((j) => j.completedDate >= WEEK && j.completedDate <= saturday)
    .filter((j) => j.technician.toLowerCase().includes(TECH.toLowerCase()))
    .map((j) => ({
      technician: j.technician,
      job_type: j.jobType,
      service_type: j.serviceType,
      d: j.completedDate,
      invoice_no: j.invoiceNo,
    }));

  // Cross-check: what the cache holds for the same span (mosquito-only).
  const cached = (await sql`
    SELECT COUNT(*)::int n FROM respray_jobs
    WHERE completed_date >= ${WEEK}::date AND completed_date <= ${saturday}::date
      AND technician ILIKE ${"%" + TECH + "%"}
  `) as Array<{ n: number }>;

  if (!rows.length) {
    console.log(`No rows for "${TECH}" in that span — check the name or the week.`);
    process.exit(1);
  }
  const who = [...new Set(rows.map((r) => r.technician))];
  console.log(`technician match: ${who.join(", ")}`);

  // Per-day, to show the Sun-Fri shape and prove Saturday is empty.
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.d, (byDay.get(r.d) || 0) + 1);
  console.log("\nALL Pocomos rows in the bucket, by day:");
  for (let i = 0; i <= 6; i++) {
    const d = addDays(WEEK, i);
    console.log(`  ${d} ${dow(d).padEnd(4)} ${String(byDay.get(d) || 0).padStart(4)}`);
  }

  // The board's rule: an APPLICATION = job_type in {initial, regular} AND a
  // mosquito-family service type. Everything else is excluded.
  const isApp = (r: { job_type: string; service_type: string }) =>
    APPLICATION_JOB_TYPES.has(r.job_type.trim().toLowerCase()) && isMosquitoServiceType(r.service_type);

  const agg = new Map<string, { counted: number; excluded: number; reason: string }>();
  for (const r of rows) {
    const key = `${r.service_type.trim() || "(blank)"} · ${r.job_type.trim()}`;
    const e = agg.get(key) || { counted: 0, excluded: 0, reason: "" };
    if (isApp(r)) e.counted++;
    else {
      e.excluded++;
      e.reason = !isMosquitoServiceType(r.service_type)
        ? "not a mosquito service type"
        : `job type "${r.job_type.trim()}" is not an application`;
    }
    agg.set(key, e);
  }

  console.log("\nBY AGREEMENT / JOB TYPE");
  console.log("  " + "service type · job type".padEnd(46) + "counted  excluded  why excluded");
  let counted = 0, excluded = 0;
  for (const [k, v] of [...agg.entries()].sort((a, b) => b[1].counted + b[1].excluded - (a[1].counted + a[1].excluded))) {
    counted += v.counted;
    excluded += v.excluded;
    console.log(`  ${k.padEnd(46)}${String(v.counted).padStart(7)}${String(v.excluded).padStart(10)}  ${v.reason}`);
  }

  // What the board itself would say, via the same weekStart() bucketing.
  const inWeekByBucket = rows.filter((r) => weekStart(r.d) === WEEK && isApp(r)).length;
  const mosquitoRows = rows.filter((r) => isMosquitoServiceType(r.service_type)).length;

  console.log("\nTIE-OUT");
  console.log(`  Pocomos rows in span (ALL service types)   ${String(rows.length).padStart(4)}`);
  console.log(`  − excluded                                 ${String(excluded).padStart(4)}`);
  console.log(`  = counted mosquito sprays                  ${String(counted).padStart(4)}`);
  console.log(`  board's own count via weekStart()          ${String(inWeekByBucket).padStart(4)}`);
  console.log(`  mosquito-family rows (what the cache keeps)${String(mosquitoRows).padStart(4)}`);
  console.log(`  respray_jobs cache rows for the same span  ${String(cached[0].n).padStart(4)}`);

  const ok =
    counted === inWeekByBucket &&
    counted + excluded === rows.length &&
    mosquitoRows === cached[0].n;
  console.log(
    `\n  ${ok ? "TIES OUT EXACTLY" : "MISMATCH"}  (${counted} counted + ${excluded} excluded = ${rows.length} Pocomos rows)`
  );
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
