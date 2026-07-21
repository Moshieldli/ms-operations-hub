import { NextResponse } from "next/server";
import { initSchema, sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/** GET current board announcements (this week / next week). */
export async function GET() {
  await initSchema();
  const rows = (await sql`SELECT this_week, next_week FROM board_announcements WHERE id = 1`) as Array<{
    this_week: string;
    next_week: string;
  }>;
  return NextResponse.json({
    ok: true,
    thisWeek: rows[0]?.this_week ?? "",
    nextWeek: rows[0]?.next_week ?? "",
  });
}

/** POST { thisWeek, nextWeek } — upsert the single announcements row. Edited from /service/board. */
export async function POST(req: Request) {
  try {
    await initSchema();
    const b = (await req.json()) as { thisWeek?: string; nextWeek?: string };
    const thisWeek = String(b.thisWeek ?? "").slice(0, 2000);
    const nextWeek = String(b.nextWeek ?? "").slice(0, 2000);
    await sql`
      INSERT INTO board_announcements (id, this_week, next_week, updated_at)
      VALUES (1, ${thisWeek}, ${nextWeek}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        this_week = EXCLUDED.this_week, next_week = EXCLUDED.next_week, updated_at = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
