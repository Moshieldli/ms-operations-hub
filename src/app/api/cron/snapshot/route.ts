import { NextResponse } from "next/server";
import { getSalesSummary } from "@/lib/pocomos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily snapshot cron — scheduled in vercel.json at `0 5 * * *` (05:00 UTC).
 *
 * Why 05:00 UTC? It maps to midnight ET during EST (Nov–Mar, UTC-5) and 1am ET
 * during EDT (Mar–Nov, UTC-4). The trade-off vs 04:00 UTC: 04:00 would be
 * midnight EDT but 23:00 EST the previous calendar day, which would put the
 * snapshot under the wrong date for 4 months of the year. 05:00 guarantees the
 * snapshot's calendar date always matches the Eastern calendar date.
 *
 * Auth: Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` on
 * cron-triggered invocations. We reject any request without it so external
 * callers can't trigger an expensive rebuild.
 *
 * Output: structured JSON line on stdout (`event: "sales.snapshot"`). Vercel
 * retains function logs for trend ingestion; persistent storage (Vercel Blob /
 * Postgres / external Sheet) is a follow-up — this route just produces the
 * line.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const t0 = Date.now();
  try {
    const summary = await getSalesSummary({ force: true });
    const snapshot = {
      event: "sales.snapshot",
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      year: summary.year,
      totals: summary.totals,
      buckets: summary.buckets,
      retainedSubtypes: summary.retainedSubtypes,
      cancelled: {
        total: summary.cancelled.total,
        thisYear: summary.cancelled.thisYear,
        lastYear: summary.cancelled.lastYear,
        earlier: summary.cancelled.earlier,
        unknown: summary.cancelled.unknown,
        byYear: summary.cancelled.byYear,
      },
      diagnostics: {
        contractsFetched: summary.debug.contractsFetched,
        contractsFailed: summary.debug.contractsFailed,
        tagsFetched: summary.debug.tagsFetched,
        tagsFailed: summary.debug.tagsFailed,
        untagged: summary.debug.untagged,
        uncategorized: summary.debug.uncategorized,
        fetchDurationMs: summary.debug.fetchDurationMs,
      },
    };
    // Single-line JSON for log ingestion / grep.
    console.log(JSON.stringify(snapshot));
    return NextResponse.json({ ok: true, snapshot });
  } catch (e) {
    const err = {
      event: "sales.snapshot.error",
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: (e as Error).message,
    };
    console.error(JSON.stringify(err));
    return NextResponse.json({ ok: false, error: err.error }, { status: 500 });
  }
}
