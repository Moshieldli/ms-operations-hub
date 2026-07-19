import { getFeedbackImage } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * GET /api/feedback/{id}/image — the item's image as a real binary response, so
 * an `<img src>` on /requests loads it lazily rather than the list payload
 * carrying every base64 blob. 404 when the item has no image.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return new Response("bad id", { status: 400 });
  const uri = await getFeedbackImage(id);
  if (!uri) return new Response("no image", { status: 404 });
  const m = uri.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!m) return new Response("bad image", { status: 415 });
  const bytes = Buffer.from(m[2], "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(bytes.length),
    },
  });
}
