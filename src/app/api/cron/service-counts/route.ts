import { NextResponse } from "next/server";
import { refreshServiceCounts } from "@/lib/service/serviceCounts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Per-year mosquito service-count scrape cron — scheduled in vercel.json.
 *
 * Fills `mosquito_service_counts` (COMPLETED mosquito services per customer per
 * year, Event Spray excluded) for the return-rate cohort. READ-ONLY GET of each
 * customer's service-history; never switches contracts. Resumable + budget-
 * capped: un-scraped cohort members first (backfill), then active members
 * re-scraped daily so the in-progress current-year count stays fresh. The /sales
 * return-rate card shows "(computing — N% covered)" until coverage completes.
 *
 * Auth: Vercel attaches `Authorization: Bearer $CRON_SECRET` on cron calls.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  try {
    const meta = await refreshServiceCounts({ budgetMs: 280_000 });
    console.log(
      JSON.stringify({ event: "mosquito.service_counts.refresh", capturedAt: new Date().toISOString(), ...meta })
    );
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    const error = (e as Error).message;
    console.error(
      JSON.stringify({
        event: "mosquito.service_counts.refresh.error",
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        error,
      })
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
