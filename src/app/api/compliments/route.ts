import { NextResponse } from "next/server";
import { createShoutout, listShoutouts } from "@/lib/service/compliments";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, items: await listShoutouts() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as {
      technician?: string;
      body?: string;
      fromName?: string;
      customerName?: string;
    };
    await createShoutout({
      technician: b.technician || "",
      body: b.body || "",
      fromName: b.fromName || "",
      customerName: b.customerName,
    });
    // Return the id of the row we just made (for optimistic UI).
    const items = await listShoutouts();
    return NextResponse.json({ ok: true, id: items[0]?.id ?? 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
