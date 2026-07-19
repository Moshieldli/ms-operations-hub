import { NextResponse } from "next/server";
import { sql, initSchema } from "@/lib/db";
import { markSelected } from "@/lib/feedback";
import { buildFeedbackPrompt, type PromptItem } from "@/lib/feedback-prompt";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/feedback/build-prompt — turn selected feedback ids into a paste-ready
 * Claude Code prompt, and (per spec) auto-mark those still-'new' items Selected.
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { ids?: number[] };
    const ids = (b.ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "no items selected" }, { status: 400 });
    }
    await initSchema();
    const rows = (await sql`
      SELECT id, body, submitter, source_url, created_at::text
      FROM feedback WHERE id = ANY(${ids}::bigint[])
      ORDER BY created_at ASC
    `) as Array<{
      id: number;
      body: string;
      submitter: string | null;
      source_url: string | null;
      created_at: string;
    }>;
    const items: PromptItem[] = rows.map((r) => ({
      id: Number(r.id),
      body: r.body,
      submitter: r.submitter,
      sourceUrl: r.source_url,
      createdAt: r.created_at,
    }));
    const prompt = buildFeedbackPrompt(items);
    await markSelected(items.map((i) => i.id));
    return NextResponse.json({ ok: true, prompt, count: items.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
