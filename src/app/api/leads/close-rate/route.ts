import { NextRequest, NextResponse } from "next/server";
import {
  getCachedReport,
  refreshCloseRate,
  computeCloseRate,
  defaultPeriod,
} from "@/lib/leads/closeRate";
import { getSyncState, setSyncState } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCK_KEY = "leads_close_rate_lock";
const LOCK_TTL_MS = 6 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/leads/close-rate
 *  - no params  → cached default-period report (fast); computes+caches if empty.
 *  - ?start&end → computed live for that range (READ-ONLY, not cached).
 */
export async function GET(req: NextRequest) {
  try {
    const start = req.nextUrl.searchParams.get("start");
    const end = req.nextUrl.searchParams.get("end");
    if (start && end) {
      if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
        return NextResponse.json(
          { ok: false, error: "start/end must be YYYY-MM-DD" },
          { status: 400 }
        );
      }
      const report = await computeCloseRate(start, end);
      return NextResponse.json({ ok: true, report, cached: false });
    }
    let report = await getCachedReport();
    if (!report) report = await refreshCloseRate();
    return NextResponse.json({ ok: true, report, cached: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

/** POST /api/leads/close-rate — recompute the default period and cache it. */
export async function POST() {
  try {
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
      const report = await refreshCloseRate();
      return NextResponse.json({ ok: true, report, period: defaultPeriod() });
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
