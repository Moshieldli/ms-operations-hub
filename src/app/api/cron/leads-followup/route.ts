import { NextResponse } from "next/server";
import { refreshLeadsFollowup } from "@/lib/leads/followup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Lead follow-up refresh cron — scheduled in vercel.json (0 7 * * * UTC, after
 * the other nightly jobs). Scrapes every OPEN lead created this year and
 * rebuilds leads_followup so /leads/followup reads instantly.
 *
 * READ-ONLY against Pocomos: GET on /lead/{id}/message-board +
 * /message/todo/{id}/show, plus the established /leads/data DataTables read
 * POST. It never touches /todos/{id}/complete or /message/todo/new.
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
    const meta = await refreshLeadsFollowup();
    console.log(JSON.stringify({ event: "leads.followup.refresh", capturedAt: new Date().toISOString(), ...meta }));
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    const error = (e as Error).message;
    console.error(
      JSON.stringify({
        event: "leads.followup.refresh.error",
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        error,
      })
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
