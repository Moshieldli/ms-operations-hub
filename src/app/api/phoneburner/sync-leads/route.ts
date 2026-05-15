import { NextResponse } from "next/server";
import { runLeadSync } from "@/lib/sync/leadSync";
import { runConversionCleanup } from "@/lib/sync/conversionCleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pocomos → PhoneBurner sync. Two phases run in sequence:
 *   1. leadSync — pull new leads via the /leads/data web back-door,
 *      dedup, push to the Fresh folder with formatted notes.
 *   2. conversionCleanup — walk every contact already in an outbound
 *      folder, move converted ones to ACTIVE_CUSTOMER, lazily refresh
 *      notes blocks older than 24h.
 *
 * The cron entry sits under `_disabled_crons` in vercel.json until the
 * sync is verified end-to-end against production.
 *
 * Auth: when CRON_SECRET is set, requires `Authorization: Bearer
 * $CRON_SECRET` (Vercel attaches this automatically on cron-triggered
 * invocations). Manual triggers from a browser will 401 unless the
 * secret is also passed.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  // Per-invocation cap so the function fits inside Vercel's 300s timeout.
  // Each lead costs ~1s for the HTML-scraped Pocomos notes + ~250ms for the
  // PhoneBurner POST + gate; 50 leads runs in ~60-90s with headroom for
  // conversionCleanup. At */15 cadence the initial 3000-lead backfill
  // finishes in ~15h; after that it's effectively realtime.
  const leadSyncLimit = Number(process.env.LEAD_SYNC_LIMIT || 50);
  const leadSync = await runLeadSync({ limit: leadSyncLimit }).catch((e) => ({
    error: (e as Error).message,
    added: 0,
    skipped_dup: 0,
    skipped_nophone: 0,
    errors: [],
    duration_ms: 0,
    watermark_before: null,
    watermark_after: null,
    pages_fetched: 0,
  }));

  const conversionCleanup = await runConversionCleanup().catch((e) => ({
    error: (e as Error).message,
    moved: 0,
    refreshed_notes: 0,
    checked: 0,
    errors: [],
    duration_ms: 0,
  }));

  const combined = {
    ok: true,
    leadSync,
    conversionCleanup,
    totalDurationMs: Date.now() - t0,
  };

  console.log(JSON.stringify({ event: "phoneburner.sync", ...combined }));
  return NextResponse.json(combined);
}
