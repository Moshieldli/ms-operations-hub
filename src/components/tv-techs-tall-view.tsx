"use client";

import { useEffect, useRef, useState } from "react";
import { TV_REFRESH_MS, useAutoReload } from "@/components/use-auto-reload";
import type { AwardWinner, TechBoard } from "@/lib/service/tech-board";
import type { ForecastDay } from "@/lib/weather";

const fmt = (n: number) => n.toLocaleString("en-US");

/** "2026-07-06" → "Jul 6". */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Tiles are narrow, so only the first name fits — and it reads friendlier. */
const firstName = (full: string) => full.trim().split(/\s+/)[0];

/**
 * Smallest tile height that still reads across a room: label + emoji row, the
 * name, and the stat line. Below this the tile is present but not legible, which
 * is worse than showing fewer tiles — hence the rotation fallback.
 */
const MIN_TILE_PX = 76;
/** Two columns only when a column would still be comfortably wide. */
const TWO_COL_MIN_WIDTH = 900;
/** Tiles per page when rotating. */
const PAGE_SIZE = 3;
const ROTATE_MS = 15_000;
const FADE_MS = 600;
/** Grid gap between tiles, in px — must match the `gap-[6px]` on the grid. */
const GAP_PX = 6;

/**
 * One award tile — the landscape board's visual language, compacted.
 *
 * Type is sized in `em` off a base font-size the parent derives from the
 * MEASURED row height, not from viewport units. Viewport-relative type can't
 * know how tall its row actually is, so at 550×700 it overflowed the tile and
 * clipped the name and stat mid-glyph. Driving everything from the row height
 * makes the tile fit by construction at any size; `overflow-hidden` is the
 * belt-and-braces guarantee that it can never spill even so.
 */
function AwardTile({ w, basePx }: { w: AwardWinner; basePx: number }) {
  return (
    <div
      data-award-tile={w.award.id}
      className="flex min-h-0 flex-col justify-center overflow-hidden rounded-[0.5em] border border-slate-700/70 bg-slate-900/70 px-[0.7em] py-[0.35em]"
      style={{ fontSize: `${basePx}px` }}
    >
      <div className="flex items-center gap-[0.4em]">
        <span className="shrink-0 text-[1.1em] leading-none">{w.award.emoji}</span>
        <span className="min-w-0 truncate text-[0.62em] font-bold uppercase tracking-[0.16em] text-emerald-400">
          {w.award.label}
        </span>
      </div>
      <div className="mt-[0.12em] truncate text-[1.3em] font-black leading-tight">
        {firstName(w.technician)}
      </div>
      <div className="truncate text-[0.78em] font-bold leading-tight text-emerald-300">
        {w.stat}
      </div>
    </div>
  );
}

/**
 * The narrow companion to `/tv/techs`, for the right-hand column of the Yodeck
 * layout. Same board data and rules, plus a weather strip that replaces Yodeck's
 * separate weather app.
 *
 * RESPONSIVE BY DESIGN: the Yodeck webpage widget IS the viewport, so sizes are
 * `clamp(min, Nvmin, max)` rather than fixed px or Tailwind steps — zoom just
 * changes the viewport and the type follows, with no breakpoints. `vmin` (not
 * `vw`) because this screen must also survive a WIDE short slot (1200×600),
 * where `vw` would blow the type up past the available height.
 *
 * ADAPTIVE AWARDS — the interesting part. The real Yodeck slot is SHORT
 * (~470×430): after the weather strip and ticker, six tiles get ~44px each,
 * which is present but unreadable across a room. Rather than pick one mode for
 * every size, the awards region measures itself and chooses:
 *   - fits (≥76px per tile row) → show all six, static.
 *   - doesn't fit → rotate 3 at a time, cross-fading every 15s, forever.
 * So 550×700, 600×900 and the wide 1200×600 (two columns) show all six at once,
 * and only the genuinely short slot rotates. Measuring the container is safe
 * from feedback loops: the awards region is the only `flex-1` element, so its
 * height is set by the shrink-0 chrome around it, never by its own content.
 *
 * PRIORITY WHEN SHORT: weather, header and ticker are `shrink-0` and always
 * render; the awards block absorbs whatever height is left.
 */
export function TvTechsTallView({
  board,
  forecast,
}: {
  board: TechBoard;
  forecast: ForecastDay[] | null;
}) {
  useAutoReload(TV_REFRESH_MS);

  const areaRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [rotate, setRotate] = useState(false);
  const [basePx, setBasePx] = useState(16);
  const [page, setPage] = useState(0);
  const [visible, setVisible] = useState(true);

  const winners = board.winners;

  // Measure the awards region: decide static-vs-rotating, then derive the tile
  // type scale from the row height that mode actually produces.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      const c = window.innerWidth >= TWO_COL_MIN_WIDTH ? 2 : 1;
      const allRows = Math.ceil(winners.length / c) || 1;
      const willRotate = h / allRows < MIN_TILE_PX;
      // Rows actually rendered once the mode is chosen.
      const rows = willRotate ? Math.ceil(Math.min(PAGE_SIZE, winners.length) / c) || 1 : allRows;
      const gaps = GAP_PX * (rows - 1);
      const rowPx = (h - gaps) / rows;
      setCols(c);
      setRotate(willRotate);
      // A tile's content is ~4.1em tall, so ~0.20 of the row keeps it inside
      // with margin to spare. Clamped so it stays legible but never cartoonish.
      setBasePx(Math.max(9, Math.min(26, rowPx * 0.2)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [winners.length]);

  const pages = Math.ceil(winners.length / PAGE_SIZE);

  // Cross-fade to the next page. Only runs while rotating.
  useEffect(() => {
    if (!rotate || pages < 2) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPage((p) => (p + 1) % pages);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [rotate, pages]);

  // Reset to the first page whenever the mode flips, so a resize never leaves
  // the screen parked on page 2 of a now-static grid.
  useEffect(() => {
    setPage(0);
    setVisible(true);
  }, [rotate]);

  const shown = rotate ? winners.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : winners;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-[2.4vmin] py-[1.6vmin] text-slate-50">
      {/* 1. Weather — top billing, and the reason the separate Yodeck app can go. */}
      {forecast && forecast.length > 0 ? (
        <div className="shrink-0 rounded-[1.4vmin] border border-slate-800 bg-slate-900/60 px-[1.8vmin] py-[1vmin]">
          <div className="grid grid-cols-4 gap-[1vmin]">
            {forecast.slice(0, 4).map((d) => (
              <div key={d.date} className="flex flex-col items-center">
                <div className="text-[clamp(8px,2.1vmin,14px)] font-bold uppercase tracking-[0.12em] text-slate-400">
                  {d.label}
                </div>
                <div className="text-[clamp(15px,4.6vmin,32px)] leading-tight">{d.emoji}</div>
                <div className="text-[clamp(10px,2.7vmin,18px)] font-bold tabular-nums">
                  {d.high}°<span className="text-slate-500">/{d.low}°</span>
                </div>
                <div className="text-[clamp(8px,2.1vmin,14px)] font-semibold tabular-nums text-sky-400">
                  💧{d.precip}%
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 2. Header */}
      <div className="mt-[1.2vmin] flex shrink-0 items-baseline justify-between gap-[1.5vmin]">
        <h1 className="text-[clamp(17px,5vmin,36px)] font-black leading-none tracking-tight">
          Tech Board
        </h1>
        <div className="shrink-0 text-[clamp(9px,2.4vmin,17px)] font-semibold text-emerald-400">
          Week of {prettyDate(board.weekStart)} – {prettyDate(board.weekEnd)}
        </div>
      </div>

      {/* 3. Awards — the only flexible region, so it absorbs a short container. */}
      {board.stale || winners.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[clamp(12px,3vmin,20px)] text-slate-500">
          Standing by for this week&rsquo;s numbers…
        </div>
      ) : (
        <div ref={areaRef} className="mt-[1.2vmin] min-h-0 flex-1">
          <div
            className={`grid h-full gap-[6px] transition-opacity duration-500 ${
              visible ? "opacity-100" : "opacity-0"
            }`}
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.ceil(shown.length / cols)}, minmax(0, 1fr))`,
            }}
          >
            {shown.map((w) => (
              <AwardTile key={w.award.id} w={w} basePx={basePx} />
            ))}
          </div>
        </div>
      )}

      {/* 4. YTD ticker */}
      <div className="mt-[1vmin] shrink-0 border-t border-slate-800 pt-[1vmin] text-[clamp(9px,2.4vmin,17px)] text-slate-400">
        <span className="font-bold text-emerald-300">{fmt(board.ytd.sprays)}</span> sprays ·{" "}
        <span className="font-bold text-emerald-300">{board.ytd.rate.toFixed(1)}%</span> team rate ·
        🎯 <span className="font-bold text-slate-200">{firstName(board.ytd.longestCleanStreakTech)}</span>{" "}
        {fmt(board.ytd.longestCleanStreak)} in a row
      </div>
    </div>
  );
}
