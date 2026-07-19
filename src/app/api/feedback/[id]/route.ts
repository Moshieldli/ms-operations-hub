import { NextResponse } from "next/server";
import { setFeedbackStatus, FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/** PATCH /api/feedback/{id} — set an item's status (New/Selected/Shipped/Declined). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  try {
    const b = (await req.json()) as { status?: string };
    if (!b.status || !(FEEDBACK_STATUSES as readonly string[]).includes(b.status)) {
      return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
    }
    await setFeedbackStatus(id, b.status as FeedbackStatus);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
