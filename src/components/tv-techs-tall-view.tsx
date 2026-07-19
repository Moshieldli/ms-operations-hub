"use client";

import { TV_REFRESH_MS, useAutoReload } from "@/components/use-auto-reload";
import type { TechBoard } from "@/lib/service/tech-board";
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

/** Awards are one line each, so only the first name fits — and it's friendlier. */
const firstName = (full: string) => full.trim().split(/\s+/)[0];

/**
 * The narrow companion to `/tv/techs`, for the right-hand column of the Yodeck
 * layout. Same board data, plus a weather strip that replaces Yodeck's separate
 * weather app.
 *
 * RESPONSIVE BY DESIGN: the Yodeck webpage widget IS the viewport, so every size
 * here is `clamp(min, Nvw, max)` rather than a fixed px or a Tailwind step. That
 * makes the screen legible anywhere in the ~500×450 → 600×900 range (and beyond)
 * without breakpoints — Yodeck's zoom just changes the viewport and the type
 * follows. Widths drive the type scale because the width band is narrow; height
 * is absorbed by flex instead.
 *
 * PRIORITY WHEN SHORT: weather, header and the YTD ticker are `shrink-0`, so
 * they always render; the awards block is the one `flex-1 min-h-0` region, so a
 * short container compresses the awards rather than pushing anything off-screen.
 */
export function TvTechsTallView({
  board,
  forecast,
}: {
  board: TechBoard;
  forecast: ForecastDay[] | null;
}) {
  useAutoReload(TV_REFRESH_MS);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-[3vw] py-[2vh] text-slate-50">
      {/* 1. Weather — top billing, and the reason the separate Yodeck app can go. */}
      {forecast && forecast.length > 0 ? (
        <div className="shrink-0 rounded-[1.5vw] border border-slate-800 bg-slate-900/60 px-[2vw] py-[1.2vh]">
          <div className="grid grid-cols-4 gap-[1vw]">
            {forecast.slice(0, 4).map((d) => (
              <div key={d.date} className="flex flex-col items-center">
                <div className="text-[clamp(9px,2.4vw,15px)] font-bold uppercase tracking-[0.12em] text-slate-400">
                  {d.label}
                </div>
                <div className="text-[clamp(18px,6vw,38px)] leading-tight">{d.emoji}</div>
                <div className="text-[clamp(11px,3.2vw,20px)] font-bold tabular-nums">
                  {d.high}°<span className="text-slate-500">/{d.low}°</span>
                </div>
                <div className="text-[clamp(9px,2.4vw,15px)] font-semibold tabular-nums text-sky-400">
                  💧{d.precip}%
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 2. Header */}
      <div className="mt-[1.5vh] shrink-0">
        <h1 className="text-[clamp(20px,6.5vw,40px)] font-black leading-none tracking-tight">
          Tech Board
        </h1>
        <div className="text-[clamp(11px,3.2vw,20px)] font-semibold text-emerald-400">
          Week of {prettyDate(board.weekStart)} – {prettyDate(board.weekEnd)}
        </div>
      </div>

      {/* 3. Awards — the only flexible region, so it absorbs a short container. */}
      {board.stale || board.winners.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[clamp(13px,3.6vw,22px)] text-slate-500">
          Standing by for this week&rsquo;s numbers…
        </div>
      ) : (
        <div className="mt-[1.2vh] flex min-h-0 flex-1 flex-col justify-evenly">
          {board.winners.map((w) => (
            <div
              key={w.award.id}
              className="flex min-h-0 items-center gap-[2vw] border-b border-slate-800/80 py-[0.4vh] last:border-b-0"
            >
              <span className="shrink-0 text-[clamp(18px,6vw,36px)] leading-none">
                {w.award.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-[clamp(16px,5.4vw,34px)] font-black leading-tight">
                {firstName(w.technician)}
              </span>
              <span className="shrink-0 text-right text-[clamp(11px,3.2vw,21px)] font-bold leading-tight text-emerald-300">
                {w.stat}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 4. YTD ticker */}
      <div className="mt-[1vh] shrink-0 border-t border-slate-800 pt-[1vh] text-[clamp(10px,2.9vw,18px)] text-slate-400">
        <span className="font-bold text-emerald-300">{fmt(board.ytd.sprays)}</span> sprays ·{" "}
        <span className="font-bold text-emerald-300">{board.ytd.rate.toFixed(1)}%</span> team rate ·
        🎯 <span className="font-bold text-slate-200">{firstName(board.ytd.longestCleanStreakTech)}</span>{" "}
        {fmt(board.ytd.longestCleanStreak)} in a row
      </div>
    </div>
  );
}
