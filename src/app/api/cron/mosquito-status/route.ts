import { NextResponse } from "next/server";
import { refreshMosquitoStatus } from "@/lib/service/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mosquito service-status refresh cron — scheduled in vercel.json.
 *
 * Scrapes every eligible customer's Pocomos service-history (READ-ONLY GET,
 * never switches the selected contract) and upserts mosquito_service_status so
 * /service/overdue reads instantly. Budget-capped + resumable: if a single run
 * can't cover all ~1,100 eligible customers within the function budget, it
 * processes the staleest first and the next run picks up the rest.
 *
 * In-season tool: during mosquito season this keeps "days since last spray"
 * fresh daily. Off-season it harmlessly marks everyone overdue (nobody's been
 * sprayed) — the UI notes this.
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
    const meta = await refreshMosquitoStatus({ budgetMs: 280_000 });
    console.log(
      JSON.stringify({ event: "mosquito.status.refresh", capturedAt: new Date().toISOString(), ...meta })
    );
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    const error = (e as Error).message;
    console.error(
      JSON.stringify({
        event: "mosquito.status.refresh.error",
        capturedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        error,
      })
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
