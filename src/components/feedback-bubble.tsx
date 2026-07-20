"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MAX_IMAGE_BYTES } from "@/lib/feedback";
import { FeedbackMarkup } from "@/components/feedback-markup";

const NAME_KEY = "ms_feedback_name";

/**
 * Floating feedback bubble (rev 42) — bottom-right on every dashboard page.
 *
 * It renders nothing on `/tv/*` (mounted only by the non-TV Shell branch, but it
 * also self-guards on pathname so it can't leak onto a kiosk screen). The form
 * auto-captures the current URL + timestamp; the image is DOWNSCALED in the
 * browser before upload so the stored base64 stays small.
 */
export function FeedbackBubble() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [markupSrc, setMarkupSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Name is remembered so each person types it once (rev 49).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setSubmitter(saved);
    } catch {
      /* localStorage unavailable — fine */
    }
  }, []);

  // Belt-and-braces: never show on a TV screen even if mounted there.
  if (pathname?.startsWith("/tv")) return null;

  const reset = () => {
    setBody("");
    // Keep the remembered name.
    setImage(null);
    setImageName(null);
    setNote(null);
    setDone(false);
    setMarkupSrc(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  /**
   * Capture the current page with html2canvas (no permission prompt, unlike
   * getDisplayMedia) and open the markup step. The feedback panel is hidden
   * during capture so it isn't in the screenshot.
   */
  const takeScreenshot = async () => {
    setNote(null);
    setOpen(false);
    setCapturing(true);
    // Let the panel actually disappear before capturing.
    await new Promise((r) => setTimeout(r, 120));
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        scale: Math.min(1.5, window.devicePixelRatio || 1),
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setMarkupSrc(canvas.toDataURL("image/jpeg", 0.9));
    } catch {
      setOpen(true);
      setNote("Couldn't capture the screen — try Attach file instead.");
    } finally {
      setCapturing(false);
    }
  };

  const onMarkupDone = async (dataUri: string) => {
    // The composited screenshot may be large — downscale to the cap.
    const shrunk = await downscaleDataUri(dataUri, 1600, 0.82);
    setImage(shrunk);
    setImageName("screenshot.jpg");
    setMarkupSrc(null);
    setOpen(true);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNote("That doesn't look like an image.");
      return;
    }
    setNote(null);
    try {
      const dataUri = await downscaleImage(file, 1600, 0.82);
      if (dataUri.length > MAX_IMAGE_BYTES * 1.4) {
        setNote("Image is too large even after shrinking — try a smaller one.");
        return;
      }
      setImage(dataUri);
      setImageName(file.name);
    } catch {
      setNote("Couldn't read that image.");
    }
  };

  const submit = async () => {
    if (!body.trim()) {
      setNote("Please add a note first.");
      return;
    }
    if (!submitter.trim()) {
      setNote("Please add your name.");
      return;
    }
    try {
      localStorage.setItem(NAME_KEY, submitter.trim());
    } catch {
      /* ignore */
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          submitter,
          sourceUrl: typeof window !== "undefined" ? window.location.href : pathname,
          imageDataUri: image,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "submit failed");
      setDone(true);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {open ? (
        <div className="w-[min(92vw,20rem)] rounded-xl border bg-background p-4 shadow-lg">
          {done ? (
            <div className="space-y-3 text-center">
              <div className="text-sm font-medium">Thanks — got it.</div>
              <p className="text-xs text-muted-foreground">
                It&rsquo;s in the queue on the Requests page.
              </p>
              <div className="flex justify-center gap-2">
                <button
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={reset}
                >
                  Add another
                </button>
                <button
                  className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Send feedback</span>
                <button
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>
              <textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What's working, what's not, or what you'd like to see…"
                rows={4}
                className="w-full resize-none rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={submitter}
                onChange={(e) => setSubmitter(e.target.value)}
                placeholder="Your name (required)"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  Attach file
                </button>
                <button
                  type="button"
                  onClick={takeScreenshot}
                  className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  Take screenshot
                </button>
                {imageName ? (
                  <span className="truncate text-xs text-muted-foreground" title={imageName}>
                    {imageName}
                  </span>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </div>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt="attachment preview"
                  className="max-h-28 w-full rounded-md border object-contain"
                />
              ) : null}
              {note ? <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p> : null}
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[11px] text-muted-foreground">
                  From {shortPath(pathname)}
                </span>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border bg-background px-4 py-2.5 text-sm font-medium shadow-lg transition-colors hover:bg-muted"
          aria-label="Send feedback"
        >
          <ChatIcon />
          Feedback
        </button>
      )}

      {capturing ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 text-sm text-white">
          Capturing…
        </div>
      ) : null}
      {markupSrc ? (
        <FeedbackMarkup
          imageDataUri={markupSrc}
          onDone={onMarkupDone}
          onCancel={() => {
            setMarkupSrc(null);
            setOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}

const shortPath = (p: string | null) => (!p ? "this page" : p.length > 28 ? p.slice(0, 27) + "…" : p);

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Downscale an image in the browser: fit within `maxDim`, re-encode as JPEG at
 * `quality`. Keeps a phone screenshot well under the 2 MB cap without the server
 * ever seeing the original. Returns a data URI.
 */
/** Downscale a data-URI image (the composited markup screenshot) to the cap. */
async function downscaleDataUri(dataUri: string, maxDim: number, quality: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUri;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUri;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

async function downscaleImage(file: File, maxDim: number, quality: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, w, h);
    // PNG screenshots with text stay crisp enough as JPEG at 0.82 and shrink a lot.
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
