import { NextResponse } from "next/server";
import {
  createFeedback,
  listFeedback,
  FEEDBACK_STATUSES,
  type FeedbackStatus,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * Feedback submit + list (rev 42). No auth (internal tool). The POST is lightly
 * rate-limited per-IP in memory — enough to stop an accidental double-submit or
 * a jammed key, not a security control.
 */

// Per-IP timestamps of recent submits. In-memory: resets on cold start, which is
// fine — this only smooths accidental floods, it isn't an abuse defense.
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (recent.size > 500) {
    for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  }
  return hits.length > MAX_PER_WINDOW;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (FEEDBACK_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as FeedbackStatus)
      : undefined;
  try {
    const items = await listFeedback(status);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many submissions — give it a minute." },
      { status: 429 }
    );
  }
  try {
    const b = (await req.json()) as {
      body?: string;
      submitter?: string;
      sourceUrl?: string;
      imageDataUri?: string;
      videoDataUri?: string;
    };
    if (!b.body || !b.body.trim()) {
      return NextResponse.json({ ok: false, error: "Feedback text is required." }, { status: 400 });
    }
    const item = await createFeedback({
      body: b.body,
      submitter: b.submitter,
      sourceUrl: b.sourceUrl,
      imageDataUri: b.imageDataUri,
      videoDataUri: b.videoDataUri,
    });
    // Never echo the image back — the bubble only needs the id to confirm.
    return NextResponse.json({ ok: true, id: item.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
