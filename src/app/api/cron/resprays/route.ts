import { NextResponse } from "next/server";
import { refreshResprays } from "@/lib/service/resprays";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Respray stats cron — scheduled in vercel.json (0 8 * * *).
 * One READ-ONLY form POST to the Pocomos completed-jobs report pulls the whole
 * year; rebuilds respray_jobs so /service/resprays reads instantly.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const meta = await refreshResprays();
    console.log(JSON.stringify({ event: "resprays.refresh", capturedAt: new Date().toISOString(), ...meta }));
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    const error = (e as Error).message;
    console.error(JSON.stringify({ event: "resprays.refresh.error", capturedAt: new Date().toISOString(), error }));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
