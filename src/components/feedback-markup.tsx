"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Screenshot markup overlay (rev 49) — draw arrows / boxes / freehand over a
 * captured page screenshot before attaching it to feedback. Red by default.
 *
 * The base screenshot is drawn once to a background canvas; annotations live on
 * a transparent canvas on top so undo/clear never touches the screenshot. On
 * Done the two are composited and returned as a JPEG data URI.
 */
type Tool = "pen" | "arrow" | "box";
const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#111827", "#ffffff"];

export function FeedbackMarkup({
  imageDataUri,
  onDone,
  onCancel,
}: {
  imageDataUri: string;
  onDone: (dataUri: string) => void;
  onCancel: () => void;
}) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [ready, setReady] = useState(false);
  // Committed strokes, so we can redraw for a live preview of arrows/boxes.
  const strokes = useRef<Array<{ tool: Tool; color: string; pts: [number, number][] }>>([]);
  const drawing = useRef<{ tool: Tool; color: string; pts: [number, number][] } | null>(null);
  const size = useRef({ w: 0, h: 0 });

  // Load the screenshot, size both canvases to it (capped so it fits the screen).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const maxW = Math.min(window.innerWidth - 32, 1400);
      const maxH = window.innerHeight - 140;
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      size.current = { w, h };
      for (const c of [bgRef.current, drawRef.current]) {
        if (!c) continue;
        c.width = w;
        c.height = h;
      }
      const ctx = bgRef.current?.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, w, h);
      setReady(true);
    };
    img.src = imageDataUri;
  }, [imageDataUri]);

  const redraw = () => {
    const c = drawRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const all = [...strokes.current];
    if (drawing.current) all.push(drawing.current);
    for (const s of all) paint(ctx, s);
  };

  const paint = (
    ctx: CanvasRenderingContext2D,
    s: { tool: Tool; color: string; pts: [number, number][] }
  ) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = s.pts;
    if (pts.length < 1) return;
    if (s.tool === "pen") {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    } else {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (s.tool === "box") {
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      } else {
        // arrow
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const head = 14;
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - head * Math.cos(ang - Math.PI / 6), b[1] - head * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(b[0] - head * Math.cos(ang + Math.PI / 6), b[1] - head * Math.sin(ang + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = drawRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * size.current.w,
      ((e.clientY - r.top) / r.height) * size.current.h,
    ];
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = { tool, color, pts: [pos(e)] };
    redraw();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = pos(e);
    if (tool === "pen") drawing.current.pts.push(p);
    else drawing.current.pts = [drawing.current.pts[0], p];
    redraw();
  };
  const onUp = () => {
    if (drawing.current && drawing.current.pts.length) strokes.current.push(drawing.current);
    drawing.current = null;
    redraw();
  };

  const undo = () => {
    strokes.current.pop();
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    redraw();
  };

  const done = () => {
    const w = size.current.w;
    const h = size.current.h;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx || !bgRef.current || !drawRef.current) return;
    ctx.drawImage(bgRef.current, 0, 0);
    ctx.drawImage(drawRef.current, 0, 0);
    onDone(out.toDataURL("image/jpeg", 0.85));
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-black/85 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-background/95 px-3 py-2 shadow">
        <span className="text-xs font-semibold">Markup:</span>
        {(["pen", "arrow", "box"] as Tool[]).map((t) => (
          <button
            key={t}
            onClick={() => setTool(t)}
            className={`rounded px-2 py-1 text-xs capitalize ${tool === t ? "bg-foreground text-background" : "border hover:bg-muted"}`}
          >
            {t}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`color ${c}`}
            className={`h-5 w-5 rounded-full border ${color === c ? "ring-2 ring-offset-1 ring-foreground" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={undo} className="rounded border px-2 py-1 text-xs hover:bg-muted">Undo</button>
        <button onClick={clear} className="rounded border px-2 py-1 text-xs hover:bg-muted">Clear</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={onCancel} className="rounded border px-2 py-1 text-xs hover:bg-muted">Cancel</button>
        <button onClick={done} className="rounded bg-foreground px-3 py-1 text-xs font-medium text-background">Attach</button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative">
          <canvas ref={bgRef} className="block rounded border border-white/20" />
          <canvas
            ref={drawRef}
            className="absolute inset-0 touch-none"
            style={{ cursor: "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        </div>
      </div>
      {!ready ? <div className="mt-2 text-sm text-white/70">Loading screenshot…</div> : null}
    </div>
  );
}
