import { NextResponse } from "next/server";
import { listClearancesSince } from "@/lib/finance/clearances";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * GET /api/finance/clearances?since=ISO — balance clearances newer than the
 * caller's per-browser last-seen marker (rev 55). Feeds the passive /finance
 * cash-register celebration. `serverNow` lets the client advance its marker
 * without trusting its own clock.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? sinceParam : null;
  try {
    const items = await listClearancesSince(since);
    return NextResponse.json({ ok: true, items, serverNow: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
