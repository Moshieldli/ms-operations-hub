import { NextResponse } from "next/server";
import { initSchema, sql, getSyncState, setSyncState } from "@/lib/db";
import { startOfSaturdayWeek } from "@/lib/pocomos";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * New-sale bell support (rev 60, §5.22). The SALES week is Sat–Fri
 * (categorize.ts::startOfSaturdayWeek) — distinct from the Sun–Fri SERVICE
 * week on the boards.
 *
 * GET  → { weekStart, baselineNew, fired } — baselineNew = snapshots.new_count
 *        at the week-start Saturday (fallback: latest snapshot before it, or 0
 *        when the table is empty). Client tally = live NEW − baselineNew.
 * POST { milestone: 10|25 } → persist that this week's milestone sound fired
 *        (sync_state, keyed by weekStart) so kiosk reloads can't re-ring.
 */

const MILESTONES = [10, 25] as const;

/** Week start (Saturday) for today's EASTERN date, as YYYY-MM-DD. */
function weekStartIso(): string {
  const eastern = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = eastern.split("-").map(Number);
  const ws = startOfSaturdayWeek(new Date(y, m - 1, d));
  const mm = String(ws.getMonth() + 1).padStart(2, "0");
  const dd = String(ws.getDate()).padStart(2, "0");
  return `${ws.getFullYear()}-${mm}-${dd}`;
}

const stateKey = (ws: string) => `sale_milestones_${ws}`;

export async function GET() {
  try {
    await initSchema();
    const ws = weekStartIso();
    // The Saturday 05:00 snapshot captures Friday-close state = the baseline.
    // Fallback to the latest earlier snapshot (cron missed) rather than 0.
    const rows = (await sql`
      SELECT new_count FROM snapshots
      WHERE snapshot_date <= ${ws}::date
      ORDER BY snapshot_date DESC LIMIT 1
    `) as Array<{ new_count: number }>;
    const baselineNew = rows.length ? Number(rows[0].new_count) : 0;
    const fired = (await getSyncState<number[]>(stateKey(ws))) ?? [];
    return NextResponse.json({ ok: true, weekStart: ws, baselineNew, fired });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initSchema();
    const b = (await req.json()) as { milestone?: number };
    if (!MILESTONES.includes(b.milestone as 10 | 25)) {
      return NextResponse.json({ ok: false, error: "invalid milestone" }, { status: 400 });
    }
    const ws = weekStartIso();
    const key = stateKey(ws);
    const fired = (await getSyncState<number[]>(key)) ?? [];
    if (!fired.includes(b.milestone!)) {
      fired.push(b.milestone!);
      await setSyncState(key, fired);
    }
    return NextResponse.json({ ok: true, weekStart: ws, fired });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
