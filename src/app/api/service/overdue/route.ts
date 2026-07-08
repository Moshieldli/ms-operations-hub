import { NextRequest, NextResponse } from "next/server";
import { getOverdueReport, refreshMosquitoStatus } from "@/lib/service/refresh";
import { getSyncState, setSyncState } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_KEY = "mosquito_service_refresh_lock";
const LOCK_TTL_MS = 6 * 60 * 1000;

/**
 * GET /api/service/overdue
 * Fast read of the mosquito overdue report straight from Postgres (no scraping).
 */
export async function GET() {
  try {
    const report = await getOverdueReport();
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/service/overdue  — "Refresh now" trigger.
 *
 * Scrapes eligible customers' service history (READ-ONLY against Pocomos) and
 * upserts mosquito_service_status. A short-lived sync_state lock prevents a
 * double-click (or overlapping cron) from running two scrapes at once.
 */
export async function POST(req: NextRequest) {
  try {
    const forceRoutes = req.nextUrl.searchParams.get("forceRoutes") === "1";
    const lock = await getSyncState<{ startedAt: string }>(LOCK_KEY);
    if (lock && Date.now() - Date.parse(lock.startedAt) < LOCK_TTL_MS) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "a refresh is already running",
      });
    }
    await setSyncState(LOCK_KEY, { startedAt: new Date().toISOString() });
    try {
      const meta = await refreshMosquitoStatus({ budgetMs: 250_000, forceRoutes });
      return NextResponse.json({ ok: true, meta });
    } finally {
      await setSyncState(LOCK_KEY, { startedAt: new Date(0).toISOString() });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
