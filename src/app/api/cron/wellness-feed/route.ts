import { NextResponse } from "next/server";
import { runWellnessFeed } from "@/lib/sync/wellnessFeed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily wellness-queue feeder (07:00, after the 06:00 mosquito refresh so
 * sprays_this_season is fresh). Pushes newly-qualified active customers
 * (2+ completed mosquito sprays this season, not yet called this season) into
 * the PhoneBurner "Wellness — Queue" folder, and reconciles any Queue contact
 * the webhook recorded but failed to move. See src/lib/sync/wellnessFeed.ts
 * and docs/REFERENCE.md §5.21.
 *
 * Auth: when CRON_SECRET is set, requires `Authorization: Bearer $CRON_SECRET`.
 * Pass `?dryRun=1` to compute counts + the would-push list with NO writes.
 *
 * LIVE since 2026-07-21 (ops go after Rivka approved the list): the cron path
 * is the bare route, so the 07:00 run pushes new qualifiers for real. The
 * initial fill was scripts/run-wellness-feed.ts --live the same day.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const feed = await runWellnessFeed({ dryRun });
    return NextResponse.json({ ok: true, feed });
  } catch (e) {
    const error = (e as Error).message;
    console.error(JSON.stringify({ event: "cron.wellness-feed.error", error }));
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
