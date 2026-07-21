import { NextResponse } from "next/server";
import { refreshTechRoster } from "@/lib/service/techRoster";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nightly: rebuild the technician roster from column A of the Technician sheet. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const r = await refreshTechRoster();
  return NextResponse.json(r);
}
