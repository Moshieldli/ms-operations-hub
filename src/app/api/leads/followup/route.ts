import { NextResponse } from "next/server";
import { getFollowupReport, refreshLeadsFollowup } from "@/lib/leads/followup";
import { getSyncState, setSyncState } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_KEY = "leads_followup_refresh_lock";
const LOCK_TTL_MS = 6 * 60 * 1000;

/** GET — fast read of the follow-up report straight from Postgres (no scraping). */
export async function GET() {
  try {
    const report = await getFollowupReport();
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST — "Refresh now". Scrapes each open this-year lead's message-board
 * (READ-ONLY GET; never marks a task complete) and rebuilds leads_followup.
 * A short-lived sync_state lock stops a double-click or an overlapping cron
 * from running two scrapes at once.
 */
export async function POST() {
  try {
    const lock = await getSyncState<{ startedAt: string }>(LOCK_KEY);
    if (lock && Date.now() - Date.parse(lock.startedAt) < LOCK_TTL_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: "a refresh is already running" });
    }
    await setSyncState(LOCK_KEY, { startedAt: new Date().toISOString() });
    try {
      const meta = await refreshLeadsFollowup();
      return NextResponse.json({ ok: true, meta });
    } finally {
      await setSyncState(LOCK_KEY, { startedAt: new Date(0).toISOString() });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
