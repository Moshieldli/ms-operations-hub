import { NextResponse } from "next/server";
import { listSnapshots } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

/**
 * GET /api/snapshots?limit=N
 *
 * Returns the most-recent N snapshots in descending date order. Default 30,
 * max 365. Public read access (no auth) — these are aggregate operational
 * numbers, not customer PII.
 *
 * Shape: { snapshots: SnapshotRow[] } where each row has every column from
 * the snapshots table plus the full SalesSummary JSON under `raw_json`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 30;
  if (!Number.isFinite(limit) || limit < 1) {
    return NextResponse.json(
      { ok: false, error: "limit must be a positive integer" },
      { status: 400 }
    );
  }

  try {
    const snapshots = await listSnapshots(limit);
    return NextResponse.json({ ok: true, count: snapshots.length, snapshots });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
