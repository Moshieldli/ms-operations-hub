import { NextResponse } from "next/server";
import { runCollectionsCheck } from "@/lib/finance/clearances";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/finance/collections-check — one Collections-Mode balance check
 * (rev 55): fresh Unpaid-Invoices pull (READ-ONLY Pocomos, ~2.5-3.5s measured)
 * diffed against the paused roster; full clears logged ring-once and the
 * stored rows zeroed. Called by /finance on visibilitychange + a ~20s poll
 * while a collections session is running. A 10s soft-lock coalesces
 * concurrent callers (`busy: true` = another check is mid-flight, skip).
 */
export async function POST() {
  try {
    const result = await runCollectionsCheck();
    return NextResponse.json({ ...result, serverNow: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, cleared: [], partials: [] },
      { status: 500 }
    );
  }
}
