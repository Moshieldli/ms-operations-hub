import { NextResponse } from "next/server";
import { setShoutoutHidden } from "@/lib/service/compliments";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/** PATCH /api/compliments/{id} { hidden } — soft-delete / restore a shout-out. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  try {
    const b = (await req.json()) as { hidden?: boolean };
    await setShoutoutHidden(id, Boolean(b.hidden));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
