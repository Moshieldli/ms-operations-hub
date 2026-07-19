/**
 * Seed / manual-override path for `referral_awards` (rev 41).
 *
 * This is the FALLBACK the spec asked for, and today it is also the live path:
 * no Google service account exists yet, so `payrollDrive.ts` is dormant and this
 * script carries the referrals that were read out of the payroll sheets by hand
 * (via the Drive connection) on 2026-07-19.
 *
 * The payroll sheets remain the source of truth — every row below quotes the
 * sheet it came from. Once the service account is provisioned, the nightly cron
 * takes over and re-confirms these same rows (the unique key makes it idempotent).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/seed-referrals.ts
 */
import { initSchema, sql } from "../src/lib/db";
import { matchTechnician, upsertReferrals, type Referral } from "../src/lib/service/referrals";

/**
 * Scanned from the last 6 weekly payroll sheets (2026-06-12 … 2026-07-17).
 *
 * DEDUPED on (tech, customer): the sheet repeats a referral across consecutive
 * weeks — Channa Noiman appears in BOTH 07-03 and 07-10, Mina Becher in BOTH
 * 06-19 and 06-26 — so each is one referral, dated to its LATEST appearance.
 *
 * NOT included, deliberately: `TAPSCOTT, NATHANIEL — $10 — "Westchester
 * walkthrough"` (week 2026-06-12). It fails the $50 test, and its note isn't a
 * customer. It is the reason the amount check exists.
 */
const FOUND: Array<{ payrollName: string; customer: string; weekEnding: string; file: string }> = [
  {
    payrollName: "ROSALES, NICHOLAS",
    customer: "Channa Noiman",
    weekEnding: "2026-07-10",
    file: "MS Payroll Calculator - 2026-07-10",
  },
  {
    payrollName: "TAPSCOTT, NATHANIEL",
    customer: "Mina Becher",
    weekEnding: "2026-06-26",
    file: "MS Payroll Calculator - 2026-06-26",
  },
];

(async () => {
  await initSchema();
  // Map payroll "LAST, FIRST" onto the Pocomos spellings the boards use.
  const techRows = (await sql`
    SELECT DISTINCT technician FROM respray_jobs WHERE technician IS NOT NULL
  `) as Array<{ technician: string }>;
  const known = techRows.map((r) => r.technician);

  const rows: Referral[] = [];
  for (const f of FOUND) {
    const tech = matchTechnician(f.payrollName, known);
    if (!tech) {
      console.log(`  !! could not map "${f.payrollName}" to a known tech — SKIPPED`);
      continue;
    }
    console.log(`  ${f.payrollName}  ->  ${tech}   (${f.customer}, wk ${f.weekEnding})`);
    rows.push({
      technician: tech,
      customerName: f.customer,
      weekEnding: f.weekEnding,
      payrollName: f.payrollName,
      sourceFileTitle: f.file,
      source: "payroll-manual",
    });
  }
  const n = await upsertReferrals(rows);
  console.log(`\nupserted ${n} referral(s)`);
  const all = (await sql`
    SELECT technician, customer_name, week_ending::text AS w,
           (week_ending + INTERVAL '1 month')::date::text AS expires
    FROM referral_awards ORDER BY week_ending DESC
  `) as Array<Record<string, string>>;
  for (const r of all) {
    console.log(`  ${r.technician} — ${r.customer_name} — wk ${r.w} — boost until ${r.expires}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
