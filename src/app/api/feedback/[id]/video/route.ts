import { getFeedbackVideo } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * GET /api/feedback/{id}/video — the item's screen recording as a real binary
 * response with the STORED content-type (webm on Chrome/Firefox, mp4 on
 * Safari), so the /requests viewer streams it lazily instead of the list
 * payload carrying multi-MB base64. Mirrors the /image route (rev 56).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return new Response("bad id", { status: 400 });
  const uri = await getFeedbackVideo(id);
  if (!uri) return new Response("no video", { status: 404 });
  const m = uri.match(/^data:(video\/[a-z0-9.+-]+)(?:;[a-z0-9.+=\- ]+)*;base64,(.*)$/i);
  if (!m) return new Response("bad video", { status: 415 });
  const bytes = Buffer.from(m[2], "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(bytes.length),
    },
  });
}
