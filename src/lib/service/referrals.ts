/**
 * Customer referrals (rev 41) — the spinning trophy on the shop TVs.
 *
 * SOURCE OF TRUTH IS THE WEEKLY PAYROLL GOOGLE SHEET, not Pocomos. Pocomos has
 * no referral attribution at all (lead `marketing_type` is ~93% blank), which is
 * exactly why this award sat in the backlog since rev 28. Payroll knows, because
 * a referral is paid.
 *
 * DETECTION RULE (probed against 6 real weeks, 2026-06-12 … 07-17):
 * a referral is an OTHER PAY row of **exactly $50** whose NOTES cell holds the
 * referred customer's name.
 *
 * ⚠️ BOTH halves of that rule are load-bearing:
 *  - The AMOUNT test is not decoration. Week 2026-06-12 carries
 *    `TAPSCOTT, NATHANIEL — $10 — "Westchester walkthrough"`. A notes-only rule
 *    would have invented a referral for a customer called "Westchester
 *    walkthrough" and put it on a TV.
 *  - The NOTES test guards the other way: a $50 row with no name is not a
 *    referral we can display (there'd be nobody to name).
 *
 * ⚠️ THE SHEET REPEATS A REFERRAL ACROSS CONSECUTIVE WEEKS. Observed twice:
 * Nicholas/Channa Noiman in both 07-03 and 07-10; Nathaniel/Mina Becher in both
 * 06-19 and 06-26. So the store is keyed on **(technician, customer)** and we
 * keep the LATEST week-ending — see `upsertReferrals`.
 */
import { sql } from "@/lib/db";

/** Exactly this amount marks an OTHER PAY row as a referral bonus. */
export const REFERRAL_AMOUNT = 50;

/**
 * How long the celebration runs. "A full month from the referral's week-ending
 * date" — a calendar month, not 30 days, so it always lands on the same
 * day-of-month and reads naturally to ops.
 */
export const REFERRAL_BOOST_MONTHS = 1;

export interface Referral {
  technician: string;
  customerName: string;
  weekEnding: string;
  payrollName: string | null;
  sourceFileTitle: string | null;
  source: string;
}

/** A parsed OTHER PAY row from one payroll tab. */
export interface PayrollOtherPayRow {
  payrollName: string;
  amount: number;
  notes: string;
}

/** Anything that clearly isn't a person's name, even at exactly $50. */
const NON_NAME = /walkthrough|reimburs|bonus|mileage|advance|training|equipment|fuel|gas\b/i;

/**
 * Is this OTHER PAY row a referral? Exactly $50 AND a plausible customer name.
 * The NON_NAME guard is belt-and-braces: today every $50 row is a real name, but
 * the sheet is hand-typed and the failure mode (a junk string on a TV) is public.
 */
export function isReferralRow(row: { amount: number; notes: string }): boolean {
  const notes = (row.notes || "").trim();
  if (Math.abs(row.amount - REFERRAL_AMOUNT) > 0.005) return false;
  if (notes.length < 3) return false;
  if (NON_NAME.test(notes)) return false;
  // A name has letters and at most a few words.
  if (!/[A-Za-z]{2,}/.test(notes)) return false;
  return notes.split(/\s+/).length <= 5;
}

/**
 * Payroll writes tabs as "LAST, FIRST" ("ROSALES, NICHOLAS"); the boards use the
 * Pocomos spelling ("Nicholas Rosales"). Match on TOKENS rather than building a
 * name, because the two systems disagree in ways a naive flip can't survive:
 * payroll "BARERRA, CESAR" vs Pocomos "Cesar Barrerra" (different spelling), and
 * payroll "MATUTE AYALA, JOSEF" vs Pocomos "Josef Matute" (extra surname).
 *
 * Requires TWO matching tokens, so a shared first name can't mis-assign a
 * referral to the wrong tech. Returns null when unsure — the caller keeps the
 * raw payroll name and the trophy is skipped rather than credited to the wrong
 * person.
 */
export function matchTechnician(payrollName: string, known: string[]): string | null {
  // Payroll writes tabs as "LAST, FIRST" — and often just "LAST, F" (a single
  // first initial, seen live on the real sheet). So we anchor on the SURNAME and
  // disambiguate a tie by the first initial, rather than requiring two full
  // tokens (which "ROSALES, N" can never satisfy).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const parts = String(payrollName).split(",");
  const payLast = norm(parts[0] || "");
  const payFirst = norm(parts[1] || "");
  if (!payLast) return null;

  // Levenshtein ≤ 2 so payroll "Barerra" matches Pocomos "Barrerra" (different
  // spelling), without matching unrelated surnames.
  const lev = (a: string, b: string): number => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
    return d[a.length][b.length];
  };
  const lastOf = (k: string) => norm(k.trim().split(/\s+/).slice(-1)[0] || "");
  const firstOf = (k: string) => norm(k.trim().split(/\s+/)[0] || "");

  const surnameHit = (k: string) => {
    const kl = lastOf(k);
    return kl === payLast || (Math.min(kl.length, payLast.length) >= 5 && lev(kl, payLast) <= 2);
  };
  let candidates = known.filter(surnameHit);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && payFirst) {
    // Disambiguate by first name / initial.
    const byFirst = candidates.filter((k) => {
      const kf = firstOf(k);
      return payFirst.length === 1 ? kf.startsWith(payFirst) : kf === payFirst || kf.startsWith(payFirst);
    });
    if (byFirst.length === 1) return byFirst[0];
  }
  return null;
}

/** ISO date + N calendar months. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/** A referral is celebrated until a full month after its week-ending date. */
export function boostExpiry(weekEnding: string): string {
  return addMonthsIso(weekEnding, REFERRAL_BOOST_MONTHS);
}

/**
 * Store referrals, keeping the LATEST week-ending per (tech, customer).
 *
 * Latest rather than earliest because the sheet repeats a referral across
 * consecutive payroll weeks: the most recent appearance is the most recent
 * confirmation, and taking the earliest would have expired Nathaniel's boost on
 * the very day it was first detected (06-19 + 1 month = 07-19 = today).
 */
export async function upsertReferrals(rows: Referral[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO referral_awards
        (technician, customer_name, week_ending, payroll_name, source_file_id,
         source_file_title, source, detected_at)
      VALUES (${r.technician}, ${r.customerName}, ${r.weekEnding}::date,
              ${r.payrollName}, ${null}, ${r.sourceFileTitle}, ${r.source}, NOW())
      ON CONFLICT (technician, customer_name) DO UPDATE SET
        week_ending = GREATEST(referral_awards.week_ending, EXCLUDED.week_ending),
        source_file_title = EXCLUDED.source_file_title,
        payroll_name = COALESCE(EXCLUDED.payroll_name, referral_awards.payroll_name),
        detected_at = NOW()
    `;
    n++;
  }
  return n;
}

/**
 * Referrals still inside their celebration month, newest first.
 * `todayIso` is passed in so the board and any verify script agree on "now".
 */
export async function getActiveReferrals(todayIso: string): Promise<Referral[]> {
  const rows = (await sql`
    SELECT technician, customer_name, week_ending::text AS week_ending,
           payroll_name, source_file_title, source
    FROM referral_awards
    WHERE (week_ending + INTERVAL '1 month') > ${todayIso}::date
    ORDER BY week_ending DESC, technician
  `) as Array<{
    technician: string;
    customer_name: string;
    week_ending: string;
    payroll_name: string | null;
    source_file_title: string | null;
    source: string;
  }>;
  return rows.map((r) => ({
    technician: r.technician,
    customerName: r.customer_name,
    weekEnding: r.week_ending,
    payrollName: r.payroll_name,
    sourceFileTitle: r.source_file_title,
    source: r.source,
  }));
}

/**
 * Techs currently inside a referral boost month. Deliberately a general concept
 * rather than "the trophy winner": ANY award tile that tech wins gets the
 * boosted treatment for the whole month, which is what makes the celebration
 * last beyond the week the trophy appears.
 */
export async function getBoostedTechs(todayIso: string): Promise<Set<string>> {
  const active = await getActiveReferrals(todayIso);
  return new Set(active.map((r) => r.technician));
}
