"use client";

import { useEffect } from "react";
import type { TechBoard } from "@/lib/service/tech-board";

/** Yodeck reloads nothing on its own — the page refreshes itself. */
const REFRESH_MS = 10 * 60 * 1000;

const fmt = (n: number) => n.toLocaleString("en-US");

/** "2026-07-06" → "Jul 6" (UTC-safe: the ISO date is already the calendar day). */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The shop-TV tech board. Deliberately non-interactive: nothing here is
 * clickable, focusable, or scrollable — Yodeck renders it as a static webpage
 * widget at 1920×1080 and never touches it. Type is sized for across-the-room
 * legibility, and the whole screen carries its own dark palette rather than
 * inheriting the dashboard theme (a TV is always dark).
 */
export function TvTechsView({ board }: { board: TechBoard }) {
  useEffect(() => {
    const t = setInterval(() => window.location.reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const hero = board.winners.filter((w) => w.award.topBilling);
  const grid = board.winners.filter((w) => !w.award.topBilling);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-10 py-8 text-slate-50">
      <header className="flex items-baseline justify-between gap-8">
        <div>
          <div className="text-lg font-semibold uppercase tracking-[0.35em] text-emerald-400">
            Mosquito Shield of Long Island
          </div>
          <h1 className="mt-2 text-6xl font-black tracking-tight">
            Tech Board
            <span className="text-slate-500"> — week of {prettyDate(board.weekStart)}</span>
          </h1>
        </div>
        <div className="text-right text-2xl font-semibold text-slate-400">
          {prettyDate(board.weekStart)} – {prettyDate(board.weekEnd)}
          <div className="text-lg font-normal text-slate-600">{board.year} season</div>
        </div>
      </header>

      {board.stale || board.winners.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-4xl font-semibold text-slate-500">
          Standing by for this week&rsquo;s numbers…
        </div>
      ) : (
        <>
          {hero.map((w) => (
            <div
              key={w.award.id}
              className="mt-6 flex items-center gap-8 rounded-3xl border-2 border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-transparent px-10 py-6"
            >
              <div className={`text-8xl ${w.award.spin ? "animate-spin-slow" : ""}`}>{w.award.emoji}</div>
              <div>
                <div className="text-2xl font-bold uppercase tracking-[0.2em] text-amber-300">
                  {w.award.label}
                </div>
                <div className="text-6xl font-black">{w.technician}</div>
                <div className="text-3xl font-semibold text-amber-200/90">{w.stat}</div>
              </div>
            </div>
          ))}

          <div className="mt-6 grid flex-1 grid-cols-3 gap-6">
            {grid.map((w) => (
              <div
                key={w.award.id}
                className="flex flex-col justify-center rounded-3xl border border-slate-700/70 bg-slate-900/70 px-8 py-6"
              >
                <div className="flex items-center gap-4">
                  <span className="text-7xl leading-none">{w.award.emoji}</span>
                  <span className="text-xl font-bold uppercase tracking-[0.18em] text-emerald-400">
                    {w.award.label}
                  </span>
                </div>
                <div className="mt-4 truncate text-5xl font-black">{w.technician}</div>
                <div className="mt-1 text-3xl font-bold text-emerald-300">{w.stat}</div>
                <div className="mt-2 text-lg text-slate-500">{w.award.blurb}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-end gap-10">
            <table className="w-[58%] text-2xl">
              <thead>
                <tr className="text-left text-lg uppercase tracking-[0.18em] text-slate-500">
                  <th className="pb-2 font-semibold">Tech</th>
                  <th className="pb-2 text-right font-semibold">Sprays</th>
                  <th className="pb-2 text-right font-semibold">Respray rate</th>
                </tr>
              </thead>
              <tbody>
                {board.table.map((r) => (
                  <tr key={r.technician} className="border-t border-slate-800">
                    <td className="py-2 font-semibold">{r.technician}</td>
                    <td className="py-2 text-right font-bold tabular-nums">{fmt(r.sprays)}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-emerald-300">
                      {r.rate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/50 px-8 py-5 text-2xl">
              <div className="text-lg uppercase tracking-[0.2em] text-slate-500">
                {board.year} season to date
              </div>
              <div className="mt-2 font-bold">
                <span className="text-emerald-300">{fmt(board.ytd.sprays)}</span> sprays ·{" "}
                <span className="text-emerald-300">{board.ytd.rate.toFixed(1)}%</span> team respray
                rate
              </div>
              {/* Kept on one line — the longer "sprays in a row" phrasing wrapped
                  at 1080p and stranded a single word under the ticker. */}
              <div className="mt-1 text-xl text-slate-400">
                🎯 Longest streak —{" "}
                <span className="font-bold text-slate-200">{board.ytd.longestCleanStreakTech}</span>,{" "}
                {fmt(board.ytd.longestCleanStreak)} in a row
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
