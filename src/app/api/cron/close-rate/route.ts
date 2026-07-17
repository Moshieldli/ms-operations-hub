import { NextResponse } from "next/server";
import { refreshCloseRate } from "@/lib/leads/closeRate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Leads close-rate cron — scheduled in vercel.json (0 9 * * *). ADDED rev 21.
 *
 * WHY: the close-rate cache had NO cron. `refreshCloseRate` only ran from the
 * page's manual Refresh button, or on GET when the cache row was MISSING — so a
 * stale-but-present row survived forever. That's how /leads came to read
 * "Updated 749h ago" (~31 days): nobody had clicked Refresh since mid-June.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await refreshCloseRate();
    console.log(
      JSON.stringify({
        event: "leads.closerate.refresh",
        capturedAt: new Date().toISOString(),
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        totalLeads: report.totalLeads,
        totalConversions: report.totalConversions,
      })
    );
    return NextResponse.json({ ok: true, computedAt: report.computedAt });
  } catch (e) {
    const error = (e as Error).message;
    console.error(JSON.stringify({ event: "leads.closerate.refresh.error", error }));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
