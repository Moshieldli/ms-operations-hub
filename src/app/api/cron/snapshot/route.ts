import { NextResponse } from "next/server";
import { getSalesSummary } from "@/lib/pocomos";
import { writeSnapshot } from "@/lib/snapshots";
import { enrichInactiveCustomers } from "@/lib/enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily snapshot cron — scheduled in vercel.json at `0 5 * * *` (05:00 UTC).
 *
 * Why 05:00 UTC? Maps to midnight ET during EST (Nov–Mar, UTC-5) and 1am ET
 * during EDT (Mar–Nov, UTC-4). The trade-off vs 04:00 UTC: 04:00 would be
 * midnight EDT but 23:00 EST the previous calendar day, which would put the
 * snapshot under the wrong date for 4 months of the year. 05:00 keeps the
 * snapshot's calendar date aligned with Eastern's year-round.
 *
 * Auth: Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` on
 * cron-triggered invocations. We reject any request without it so external
 * callers can't trigger an expensive rebuild.
 *
 * Pipeline (two phases, snapshot first so it's persisted even if enrichment
 * times out):
 *   1. Force-rebuild the active dataset, compute the SalesSummary, write a
 *      row into Postgres `snapshots` keyed by Eastern calendar date.
 *   2. Enrich Inactive / On-Hold customers (contracts + per-contract tags)
 *      and upsert into Postgres `customers`. Resumable across runs — sorted
 *      by oldest `refreshed_at` so subsequent invocations pick up unfinished
 *      work. Budget-capped so phase 2 yields gracefully before the function
 *      timeout.
 *
 * Output: a single-line `sales.snapshot` JSON event via console.log for
 * log-based trend ingestion, plus the snapshot is in Postgres for queryable
 * trend history.
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
  let snapshotResult: { snapshotDate: string; inserted: boolean } | null = null;
  let snapshotError: string | null = null;

  // Phase 1: snapshot (must succeed for the cron to be useful).
  try {
    const summary = await getSalesSummary({ force: true });
    snapshotResult = await writeSnapshot(summary);
    const snapshot = {
      event: "sales.snapshot",
      capturedAt: new Date().toISOString(),
      snapshotDate: snapshotResult.snapshotDate,
      inserted: snapshotResult.inserted,
      durationMs: Date.now() - t0,
      year: summary.year,
      totals: summary.totals,
      buckets: summary.buckets,
      retainedSubtypes: summary.retainedSubtypes,
      cancelled: summary.cancelled,
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
    console.log(JSON.stringify(snapshot));
  } catch (e) {
    snapshotError = (e as Error).message;
    console.error(
      JSON.stringify({
        event: "sales.snapshot.error",
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        error: snapshotError,
      })
    );
    return NextResponse.json(
      { ok: false, phase: "snapshot", error: snapshotError },
      { status: 500 }
    );
  }

  // Phase 2: enrichment. Best-effort — failure here doesn't fail the cron.
  // Budget = (total maxDuration) - (snapshot elapsed) - safety margin.
  let enrichmentResult: Awaited<ReturnType<typeof enrichInactiveCustomers>> | null = null;
  let enrichmentError: string | null = null;
  const totalBudget = 290_000; // 290s, 10s under maxDuration=300
  const elapsedSnapshot = Date.now() - t0;
  const remainingBudget = Math.max(0, totalBudget - elapsedSnapshot - 5_000);

  if (remainingBudget > 30_000) {
    try {
      enrichmentResult = await enrichInactiveCustomers({
        budgetMs: remainingBudget,
        maxCustomers: 1500,
      });
      console.log(
        JSON.stringify({
          event: "sales.enrichment",
          capturedAt: new Date().toISOString(),
          ...enrichmentResult,
        })
      );
    } catch (e) {
      enrichmentError = (e as Error).message;
      console.error(
        JSON.stringify({
          event: "sales.enrichment.error",
          capturedAt: new Date().toISOString(),
          error: enrichmentError,
        })
      );
    }
  }

  return NextResponse.json({
    ok: true,
    snapshot: snapshotResult,
    enrichment: enrichmentResult,
    enrichmentError,
    totalDurationMs: Date.now() - t0,
  });
}
