/**
 * In-dashboard feedback / feature-request queue (rev 42).
 *
 * Staff submit from the floating bubble on any dashboard page; the /requests
 * page reviews them, cycles their status, and builds a ready-to-paste Claude
 * Code prompt from the selected ones.
 *
 * No Pocomos. No auth (internal tool). Images live inline as base64 data URIs —
 * see db.ts for why that's the right call at this volume.
 */
import { initSchema, sql } from "@/lib/db";

/** The status a feedback item can hold. Cycles New → Selected → Shipped → Declined. */
export const FEEDBACK_STATUSES = ["new", "selected", "shipped", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Human labels for the statuses (the DB stores the lowercase key). */
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  selected: "Selected",
  shipped: "Shipped",
  declined: "Declined",
};

/** Max stored image size — a data URI is ~1.37× its bytes, so ~2 MB image → ~2.7 MB string. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Max stored screen-recording size (rev 56). Ceiling is the ~4.5 MB Vercel
 * request-body limit, NOT the 60s: base64 inflates ~1.37×, so 3 MB of encoded
 * video+audio → ~4.1 MB on the wire (probed: vp9 350kbps + opus 32kbps worst-
 * cases ~2.9 MB for a full 60s; the recorder auto-stops at 95% of this cap).
 */
export const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
/** Reject bodies longer than this (a paragraph or two is plenty; guards the table). */
export const MAX_BODY_CHARS = 4000;

export interface FeedbackItem {
  id: number;
  body: string;
  submitter: string | null;
  sourceUrl: string | null;
  imageDataUri: string | null;
  videoDataUri: string | null;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewFeedback {
  body: string;
  submitter?: string | null;
  sourceUrl?: string | null;
  imageDataUri?: string | null;
  videoDataUri?: string | null;
}

/** List-row shape: everything but the heavy blobs, plus `hasImage`/`hasVideo` flags. */
export type FeedbackListItem = Omit<FeedbackItem, "imageDataUri" | "videoDataUri"> & {
  hasImage: boolean;
  hasVideo: boolean;
};

function coerceStatus(s: string): FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(s) ? (s as FeedbackStatus) : "new";
}

type Row = {
  id: number;
  body: string;
  submitter: string | null;
  source_url: string | null;
  image_data_uri: string | null;
  video_data_uri: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const toItem = (r: Row): FeedbackItem => ({
  id: Number(r.id),
  body: r.body,
  submitter: r.submitter,
  sourceUrl: r.source_url,
  imageDataUri: r.image_data_uri,
  videoDataUri: r.video_data_uri,
  status: coerceStatus(r.status),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** A base64 image data URI, within the size cap. Anything else stores as null. */
function safeImage(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(uri)) return null;
  if (uri.length > MAX_IMAGE_BYTES * 1.4) return null;
  return uri;
}

/**
 * A base64 video data URI within the cap, or null (dropped, never an error).
 * The mime stays whatever MediaRecorder produced (webm on Chrome/Firefox,
 * mp4 on Safari) — it's served back with the stored content-type.
 */
function safeVideo(uri: string | null | undefined): string | null {
  if (!uri) return null;
  // The client normalizes to a bare container mime, but tolerate comma-free
  // parameters (e.g. ";codecs=vp8") in case a browser sneaks one through.
  if (!/^data:video\/[a-z0-9.+-]+(?:;[a-z0-9.+=\- ]+)*;base64,/i.test(uri)) return null;
  if (uri.length > MAX_VIDEO_BYTES * 1.4) return null;
  return uri;
}

/** Insert one feedback item. Trims/caps the body; validates the image. */
export async function createFeedback(input: NewFeedback): Promise<FeedbackItem> {
  await initSchema();
  const body = (input.body || "").trim().slice(0, MAX_BODY_CHARS);
  if (!body) throw new Error("feedback body is required");
  const submitter = (input.submitter || "").trim().slice(0, 120) || null;
  const sourceUrl = (input.sourceUrl || "").trim().slice(0, 500) || null;
  const image = safeImage(input.imageDataUri);
  const video = safeVideo(input.videoDataUri);
  const rows = (await sql`
    INSERT INTO feedback (body, submitter, source_url, image_data_uri, video_data_uri)
    VALUES (${body}, ${submitter}, ${sourceUrl}, ${image}, ${video})
    RETURNING id, body, submitter, source_url, image_data_uri, video_data_uri, status,
              created_at::text, updated_at::text
  `) as Row[];
  return toItem(rows[0]);
}

/**
 * List feedback, newest first, optionally filtered by status. The image column
 * is heavy, so this returns a lightweight flag instead of the data URI; the row
 * that needs the full image fetches it via `getFeedbackImage`.
 */
export async function listFeedback(status?: FeedbackStatus): Promise<FeedbackListItem[]> {
  await initSchema();
  const rows = (status
    ? await sql`
        SELECT id, body, submitter, source_url,
               (image_data_uri IS NOT NULL) AS has_image,
               (video_data_uri IS NOT NULL) AS has_video, status,
               created_at::text, updated_at::text
        FROM feedback WHERE status = ${status}
        ORDER BY created_at DESC`
    : await sql`
        SELECT id, body, submitter, source_url,
               (image_data_uri IS NOT NULL) AS has_image,
               (video_data_uri IS NOT NULL) AS has_video, status,
               created_at::text, updated_at::text
        FROM feedback
        ORDER BY created_at DESC`) as Array<Row & { has_image: boolean; has_video: boolean }>;
  return rows.map((r) => ({
    id: Number(r.id),
    body: r.body,
    submitter: r.submitter,
    sourceUrl: r.source_url,
    status: coerceStatus(r.status),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasImage: Boolean(r.has_image),
    hasVideo: Boolean(r.has_video),
  }));
}

/** The full image data URI for one item (served on demand, not in the list). */
export async function getFeedbackImage(id: number): Promise<string | null> {
  await initSchema();
  const rows = (await sql`SELECT image_data_uri FROM feedback WHERE id = ${id}`) as Array<{
    image_data_uri: string | null;
  }>;
  return rows[0]?.image_data_uri ?? null;
}

/** The full video data URI for one item (served on demand, not in the list). */
export async function getFeedbackVideo(id: number): Promise<string | null> {
  await initSchema();
  const rows = (await sql`SELECT video_data_uri FROM feedback WHERE id = ${id}`) as Array<{
    video_data_uri: string | null;
  }>;
  return rows[0]?.video_data_uri ?? null;
}

/** Set an item's status. Returns the updated item. */
export async function setFeedbackStatus(id: number, status: FeedbackStatus): Promise<void> {
  await initSchema();
  await sql`UPDATE feedback SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
}

/** Mark a batch Selected (used when items are folded into a built prompt). */
export async function markSelected(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await initSchema();
  // Only promote items that are still 'new' — never demote a Shipped/Declined
  // item just because it was re-included in a prompt.
  await sql`
    UPDATE feedback SET status = 'selected', updated_at = NOW()
    WHERE id = ANY(${ids}::bigint[]) AND status = 'new'
  `;
}
