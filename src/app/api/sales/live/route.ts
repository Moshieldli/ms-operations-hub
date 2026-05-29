import { NextResponse } from "next/server";
import { getSalesSummary } from "@/lib/pocomos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/sales/live
 *
 * Returns the live-built SalesSummary (the same getSalesSummary() the page used
 * to call directly, keeping its 10-min in-memory cache). The /sales and
 * /tv/sales pages paint instantly from the latest snapshot, then call this in
 * the background and swap the fresh numbers in when they arrive.
 *
 * This is intentionally just an exposure of the existing live build — no change
 * to the build logic. A cold build does the full Pocomos fetch (~55s), so
 * maxDuration is 300; warm instances answer from the in-memory cache.
 */
export async function GET() {
  try {
    const summary = await getSalesSummary();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
