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

/** Tiles are compact, so only the first name fits — and it reads friendlier. */
const firstName = (full: string) => full.trim().split(/\s+/)[0];

/** Grid gap between tiles, in px — must match the `gap-[6px]` on the grid. */
const GAP_PX = 6;
/** Below this width a tall region stacks in one column instead of two. */
const NARROW_MAX = 700;
/** At/above this width there's room for three across. */
const WIDE_MIN = 1000;

/**
 * Column count for the awards wall. Explicit rules beat "optimise the tile
 * aspect ratio", which quietly disagreed with what each real slot needs:
 *  - genuinely TALL and NARROW (e.g. 600×900) → one stacked column.
 *  - wide (≥1000px, e.g. 1200×600) → three across.
 *  - everything else, including the real short Yodeck slot (~470×430) and
 *    550×700 → TWO columns, so all six tiles land as a 2×3 wall.
 */
function columnsFor(w: number, h: number): number {
  if (h > w && w < NARROW_MAX) return 1;
  if (w >= WIDE_MIN) return 3;
  return 2;
}

/**
 * One award tile — the landscape board's visual language, compacted and centred
 * for the wall.
 *
 * Type is sized in `em` off a base the parent derives from the MEASURED tile
 * box, not from viewport units. Viewport-relative type can't know how big its
 * cell is: it overflowed and clipped names mid-glyph at 550×700 while the
 * document itself fit perfectly. `overflow-hidden` is the belt-and-braces
 * guarantee that a tile can never spill even so.
 */
function AwardTile({ w, basePx }: { w: AwardWinner; basePx: number }) {
  return (
    <div
      data-award-tile={w.award.id}
      className="flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden rounded-[0.5em] border border-slate-700/70 bg-slate-900/70 px-[0.5em] py-[0.3em] text-center"
      style={{ fontSize: `${basePx}px` }}
    >
      <div className="flex max-w-full items-center justify-center gap-[0.35em]">
        <span className="shrink-0 text-[1.15em] leading-none">{w.award.emoji}</span>
        <span className="min-w-0 truncate text-[0.6em] font-bold uppercase tracking-[0.14em] text-emerald-400">
          {w.award.label}
        </span>
      </div>
      <div className="mt-[0.1em] max-w-full truncate text-[1.35em] font-black leading-tight">
        {firstName(w.technician)}
      </div>
      <div className="max-w-full truncate text-[0.72em] font-bold leading-tight text-emerald-300">
        {w.stat}
      </div>
    </div>
  );
}

/**
 * The narrow companion to `/tv/techs`, for the right-hand column of the Yodeck
 * layout: a weather strip (replacing Yodeck's separate weather app), the week's
 * award wall, and a YTD ticker.
 *
 * ALL SIX AWARDS ARE ALWAYS VISIBLE — there is no rotation. The grid reshapes
 * instead (see `columnsFor`) and the type scales off the measured tile box, so
 * even the short ~470×430 slot shows a full 2×3 wall rather than a slideshow.
 *
 * RESPONSIVE BY DESIGN: the Yodeck webpage widget IS the viewport, so chrome
 * sizes are `clamp(min, Nvmin, max)` rather than fixed px or Tailwind steps —
 * zoom just changes the viewport and the type follows, with no breakpoints.
 * `vmin` (not `vw`) because this must also survive a WIDE SHORT slot (1200×600),
 * where `vw` would blow the type up past the available height.
 *
 * PRIORITY WHEN SHORT: weather, header and ticker are `shrink-0` and always
 * render; the awards wall is the only `flex-1` region, so it absorbs whatever
 * height is left. Measuring it is feedback-loop-safe for exactly that reason —
 * its height comes from the chrome around it, never from its own content.
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
  const [cols, setCols] = useState(2);
  const [basePx, setBasePx] = useState(16);

  const winners = board.winners;
  const count = winners.length;

  useEffect(() => {
    const el = areaRef.current;
    if (!el || count === 0) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const c = columnsFor(w, h);
      const rows = Math.ceil(count / c) || 1;
      const tileW = (w - GAP_PX * (c - 1)) / c;
      const tileH = (h - GAP_PX * (rows - 1)) / rows;
      setCols(c);
      // Height sets the scale (a tile's content is ~4.3em tall); width caps it so
      // a long stat like "75 sprays, 0 resprays" isn't truncated on a squat tile.
      setBasePx(Math.max(8, Math.min(34, Math.min(tileH * 0.2, tileW * 0.125))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [count]);

  const rows = Math.ceil(count / cols) || 1;

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

      {/* 3. The award wall — the only flexible region, filling edge to edge. */}
      {board.stale || count === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[clamp(12px,3vmin,20px)] text-slate-500">
          Standing by for this week&rsquo;s numbers…
        </div>
      ) : (
        <div ref={areaRef} className="mt-[1.2vmin] min-h-0 flex-1">
          <div
            className="grid h-full w-full gap-[6px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {winners.map((w) => (
              <AwardTile key={w.award.id} w={w} basePx={basePx} />
            ))}
          </div>
        </div>
      )}

      {/* 4. YTD ticker */}
      <div className="mt-[1vmin] shrink-0 border-t border-slate-800 pt-[1vmin] text-center text-[clamp(9px,2.4vmin,17px)] text-slate-400">
        <span className="font-bold text-emerald-300">{fmt(board.ytd.sprays)}</span> sprays ·{" "}
        <span className="font-bold text-emerald-300">{board.ytd.rate.toFixed(1)}%</span> team rate ·
        🎯 <span className="font-bold text-slate-200">{firstName(board.ytd.longestCleanStreakTech)}</span>{" "}
        {fmt(board.ytd.longestCleanStreak)} in a row
      </div>
    </div>
  );
}
