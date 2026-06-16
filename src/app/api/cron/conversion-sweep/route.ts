import { NextResponse } from "next/server";
import { runConversionSweep } from "@/lib/sync/conversionSweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Hourly conversion sweep (roster-reconciliation model). Walks the policed
 * dial/cancelled PhoneBurner folders and moves any contact that is a current
 * active customer into the Active Customer folder. Decoupled from the every-
 * 15-min lead-push sync — see src/lib/sync/conversionSweep.ts and docs/REFERENCE.md §5.5b.
 *
 * Auth: when CRON_SECRET is set, requires `Authorization: Bearer $CRON_SECRET`
 * (Vercel attaches this on cron-triggered invocations). Pass `?dryRun=1` to
 * scan + count without moving anything (no PhoneBurner writes).
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const sweep = await runConversionSweep({ dryRun }).catch((e) => ({
    error: (e as Error).message,
    dryRun,
    scanned: 0,
    matchedById: 0,
    matchedByPhone: 0,
    nameMismatchSkipped: 0,
    noMatch: 0,
    wouldMove: 0,
    moved: 0,
    rosterActiveCount: 0,
    perFolder: {},
    reviews: [],
    errors: [],
    duration_ms: 0,
  }));

  console.log(JSON.stringify({ event: "cron.conversion-sweep", ...sweep }));
  return NextResponse.json({ ok: true, sweep });
}
