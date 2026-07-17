import { NextResponse } from "next/server";
import { getRespraysReport, refreshResprays } from "@/lib/service/resprays";
import { getSyncState, setSyncState } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_KEY = "resprays_refresh_lock";
const LOCK_TTL_MS = 6 * 60 * 1000;

/** GET — fast read of the respray report from Postgres (no Pocomos calls). */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, report: await getRespraysReport() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** POST — "Refresh now": re-pull the completed-jobs report (READ-ONLY render). */
export async function POST() {
  try {
    const lock = await getSyncState<{ startedAt: string }>(LOCK_KEY);
    if (lock && Date.now() - Date.parse(lock.startedAt) < LOCK_TTL_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: "a refresh is already running" });
    }
    await setSyncState(LOCK_KEY, { startedAt: new Date().toISOString() });
    try {
      return NextResponse.json({ ok: true, meta: await refreshResprays() });
    } finally {
      await setSyncState(LOCK_KEY, { startedAt: new Date(0).toISOString() });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
