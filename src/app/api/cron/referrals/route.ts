import { initSchema, sql } from "@/lib/db";
import { scanPayrollReferrals, hasDriveCredentials } from "@/lib/service/payrollDrive";
import { upsertReferrals } from "@/lib/service/referrals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly payroll → referral scan (rev 41).
 *
 * Reads the newest ~6 weekly payroll sheets and upserts any $50 OTHER PAY row
 * whose NOTES holds a customer name. Idempotent: the (tech, customer) key means
 * re-reading the same referral across consecutive weekly sheets just refreshes
 * its week-ending date.
 *
 * ⚠️ NO-OPS CLEANLY without Google credentials — it reports `skipped` with a
 * reason and returns 200 rather than failing the cron. Until the service account
 * exists, `referral_awards` is maintained by `scripts/seed-referrals.ts` and the
 * board is fully live off that; this route takes over the moment the env vars
 * are set, with no other change.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    await initSchema();
    if (!hasDriveCredentials()) {
      return Response.json({
        ok: true,
        skipped: true,
        reason:
          "Google service account not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / " +
          "GOOGLE_PRIVATE_KEY). referral_awards left as-is — seeded manually.",
      });
    }
    const techRows = (await sql`
      SELECT DISTINCT technician FROM respray_jobs WHERE technician IS NOT NULL
    `) as Array<{ technician: string }>;
    const report = await scanPayrollReferrals(techRows.map((r) => r.technician), 6);
    const upserted = await upsertReferrals(report.referrals);
    return Response.json({
      ok: true,
      filesScanned: report.filesScanned,
      rowsSeen: report.rowsSeen,
      referralsFound: report.referrals.length,
      upserted,
      unmatched: report.unmatched,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
