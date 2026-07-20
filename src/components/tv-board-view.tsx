"use client";

import { TV_REFRESH_MS, useAutoReload } from "@/components/use-auto-reload";
import { PrecipIcon, WeatherIcon } from "@/components/tv-icons";
import type { ScheduleBoard } from "@/lib/service/scheduleBoard";

/**
 * `/tv/board` — the digital route schedule board (rev 45), replacing the Google
 * Sheet on the shop TV. 1920×1080 landscape, Yodeck-safe: inline SVG only (no
 * emoji — Yodeck's Linux browser has no color-emoji font), inline styles, no
 * interaction, self-refresh.
 *
 * v1 is DISPLAY-ONLY off Pocomos + the DAYCODES snapshot + weather. Tech names
 * and ANT markers light up once the routing sheet is connected (see
 * `masterRouting.ts`); a small badge shows whether the sheet is feeding it.
 */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Small caution triangle (SVG, no emoji) for the ANT rain marker. */
function CautionIcon({ size = "1em", color = "#f59e0b" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Wind/leaf glyph for the Electric-Blower marker. */
function BlowerIcon({ size = "1em", color = "#38bdf8" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
      <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
    </svg>
  );
}

export function TvBoardView({ board }: { board: ScheduleBoard | null }) {
  useAutoReload(TV_REFRESH_MS);

  if (!board || board.days.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-2xl text-slate-500">
        Schedule board standing by…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-8 py-6 text-slate-50">
      <header className="flex items-baseline justify-between gap-6">
        <div>
          <div className="text-base font-semibold uppercase tracking-[0.35em] text-sky-400">
            Mosquito Shield of Long Island
          </div>
          <h1 className="mt-1 text-5xl font-black tracking-tight">Route Board</h1>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>Today + next 4 workdays</div>
          <div>
            {board.sheetConnected ? (
              <span className="text-emerald-400">routing sheet connected</span>
            ) : (
              <span className="text-slate-500">Pocomos schedule · sheet not connected</span>
            )}
          </div>
        </div>
      </header>

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-5 gap-3">
        {board.days.map((day) => (
          <div
            key={day.date}
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50"
          >
            {/* Day header + weather */}
            <div className="shrink-0 border-b border-slate-800 px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black">{day.label}</span>
                <span className="text-sm text-slate-400">{prettyDate(day.date)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                {day.weather ? (
                  <div className="flex items-center gap-2">
                    <WeatherIcon code={day.weather.code} size="28px" />
                    <span className="text-lg font-bold tabular-nums">
                      {day.weather.high}°<span className="text-slate-500">/{day.weather.low}°</span>
                    </span>
                    <span className="flex items-center gap-0.5 text-sm font-semibold tabular-nums text-sky-400">
                      <PrecipIcon size="0.9em" />
                      {day.weather.precip}%
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-600">—</span>
                )}
                <span className="text-sm font-semibold text-slate-300">
                  {day.totalStops} <span className="font-normal text-slate-500">stops</span>
                </span>
              </div>
              {/* Markers row */}
              <div className="mt-2 flex min-h-[1.25rem] flex-wrap items-center gap-2 text-xs">
                {day.antRainRisk ? (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-950/60 px-1.5 py-0.5 font-semibold text-amber-300">
                    <CautionIcon size="0.9em" /> Ant needs 3 dry days
                  </span>
                ) : null}
                {day.electricBlower > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded bg-sky-950/60 px-1.5 py-0.5 font-semibold text-sky-300">
                    <BlowerIcon size="0.9em" /> {day.electricBlower} elec. blower
                  </span>
                ) : null}
              </div>
            </div>

            {/* Routes */}
            <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
              {day.routes.length === 0 ? (
                <div className="px-2 py-4 text-sm text-slate-600">No stops scheduled.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {day.routes.map((r) => (
                    <div
                      key={r.daycode}
                      className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-1.5">
                          <span className="font-mono text-base font-bold text-sky-300">
                            {r.daycode}
                          </span>
                          {r.ant ? <CautionIcon size="0.85em" /> : null}
                          {r.tech ? (
                            <span className="text-sm font-semibold text-slate-200">{r.tech}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">
                          {r.stops}
                        </span>
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {r.area || "—"}
                        {r.towns.length > 0 ? (
                          <span className="text-slate-600">
                            {" · "}
                            {r.towns.slice(0, 3).join(", ")}
                            {r.towns.length > 3 ? "…" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Day note from the sheet */}
            {day.note ? (
              <div className="shrink-0 border-t border-slate-800 px-3 py-1.5 text-xs text-amber-300/80">
                {day.note}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 shrink-0 text-center text-xs text-slate-600">
        Live schedule from Pocomos · route codes &amp; towns from the 2026 Master Routing List ·
        tech names and ant-day markers activate when the routing sheet is connected.
      </div>
    </div>
  );
}
