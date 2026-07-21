"use client";

import { useEffect, useState } from "react";
import { TV_REFRESH_MS, useAutoReload } from "@/components/use-auto-reload";
import { PrecipIcon, WeatherIcon } from "@/components/tv-icons";
import type { ScheduleBoard, BoardRoute } from "@/lib/service/scheduleBoard";

/**
 * `/tv/board` + `/service/board` — the digital route board (rev 50), mirroring
 * the physical schedule board. Tech-first rows from the Master Routing CALENDAR
 * (primary) + Pocomos markers (secondary). Yodeck-safe: inline SVG only (no
 * emoji), inline styles, 1080p, self-refresh.
 *
 * One component, two modes: `interactive=false` (TV, pure display) and
 * `interactive=true` (/service/board — announcement editor + shout-out form +
 * soft-delete live in the parent and are passed as `extras`).
 */
export interface Shoutout {
  id: number;
  technician: string;
  body: string;
  fromName: string;
  customerName: string | null;
  createdAt: string;
}

const LEGEND: Array<[string, string]> = [
  ["LC", "Local"],
  ["LI", "Long Island"],
  ["BK", "Brooklyn"],
  ["GN", "Great Neck"],
  ["QU", "Queens"],
  ["WC", "Westchester"],
];

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function CautionIcon({ size = "1em", color = "#f59e0b" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function BugIcon({ size = "1em", color = "#fb7185" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M8 2l1.5 1.5M16 2l-1.5 1.5" />
      <path d="M12 20a6 6 0 0 0 6-6v-2a6 6 0 1 0-12 0v2a6 6 0 0 0 6 6z" />
      <path d="M12 6v14M3 9h3M3 14h3M3 19l3-2M18 9h3M18 14h3M18 19l-3-2" />
    </svg>
  );
}
function BoltIcon({ size = "1em", color = "#38bdf8" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill={color} stroke="none" aria-hidden="true">
      <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />
    </svg>
  );
}
function MegaphoneIcon({ size = "1em", color = "#fbbf24" }: { size?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l14-7v16L3 13z" />
      <path d="M3 11v2M17 8a4 4 0 0 1 0 8" />
    </svg>
  );
}

function RouteRow({ r }: { r: BoardRoute }) {
  if (r.off) {
    return (
      <div className="flex items-baseline justify-between gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
        <span className="font-semibold text-slate-200">{r.tech}</span>
        <span className="text-xs font-bold uppercase tracking-wide text-amber-400">{r.off}</span>
      </div>
    );
  }
  return (
    <div className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-1.5 truncate">
          <span className="truncate font-semibold text-slate-100">{r.tech}</span>
          {r.ant ? <BugIcon size="0.9em" /> : null}
          {r.electricBlower > 0 ? <BoltIcon size="0.9em" /> : null}
        </span>
        <span className="shrink-0 font-mono text-sm font-bold text-sky-300">{r.daycode}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-slate-400">
        <span className="truncate">
          {r.van ? <span className="text-slate-500">{r.van} · </span> : null}
          {r.towns || "—"}
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-emerald-300">
          {r.stops ?? "—"}
        </span>
      </div>
    </div>
  );
}

export function TvBoardView({
  board,
  shoutouts = [],
  interactive = false,
  extras = null,
}: {
  board: ScheduleBoard | null;
  shoutouts?: Shoutout[];
  interactive?: boolean;
  /** /service/board injects its edit controls (announcement editor, shout-out form). */
  extras?: React.ReactNode;
}) {
  useAutoReload(interactive ? 0 : TV_REFRESH_MS);
  const [shoutIdx, setShoutIdx] = useState(0);

  if (!board || board.days.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-2xl text-slate-500">
        Route board standing by…
      </div>
    );
  }

  // Rotate the shout-outs panel when there are more than fit.
  const SHOUT_PAGE = 4;
  const shoutPages = Math.max(1, Math.ceil(shoutouts.length / SHOUT_PAGE));
  const shownShouts = shoutouts.slice(
    (shoutIdx % shoutPages) * SHOUT_PAGE,
    (shoutIdx % shoutPages) * SHOUT_PAGE + SHOUT_PAGE
  );

  return (
    <div className={interactive ? "min-h-screen w-full bg-slate-950 p-4 text-slate-50" : "flex h-screen w-screen flex-col overflow-hidden bg-slate-950 px-6 py-4 text-slate-50"}>
      <header className="flex shrink-0 items-baseline justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-400">
            Mosquito Shield of Long Island
          </div>
          <h1 className="text-4xl font-black tracking-tight">Route Board</h1>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{prettyDate(board.days[0].date)} – {prettyDate(board.days[board.days.length - 1].date)}</div>
          <div>
            {board.sheetConnected ? (
              <span className="text-emerald-400">routing sheet connected</span>
            ) : (
              <span>Pocomos schedule · sheet not connected</span>
            )}
          </div>
        </div>
      </header>

      {/* Legend */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {LEGEND.map(([abbr, full]) => (
          <span key={abbr}>
            <span className="font-mono font-bold text-sky-300">{abbr}</span> {full}
          </span>
        ))}
        <span className="ml-2 inline-flex items-center gap-1"><BugIcon size="1em" /> ant day</span>
        <span className="inline-flex items-center gap-1"><BoltIcon size="1em" /> electric blower</span>
      </div>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        {/* Day columns */}
        <div className="grid min-h-0 grid-cols-5 gap-2">
          {board.days.map((day) => (
            <div key={day.date} className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              <div className="shrink-0 border-b border-slate-800 px-2 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black">{day.label}</span>
                  <span className="text-xs text-slate-400">{prettyDate(day.date)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  {day.weather ? (
                    <span className="flex items-center gap-1.5">
                      <WeatherIcon code={day.weather.code} size="22px" />
                      <span className="text-sm font-bold tabular-nums">
                        {day.weather.high}°<span className="text-slate-500">/{day.weather.low}°</span>
                      </span>
                      <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums text-sky-400">
                        <PrecipIcon size="0.85em" />{day.weather.precip}%
                      </span>
                    </span>
                  ) : <span className="text-xs text-slate-600">—</span>}
                </div>
                {day.antRainRisk ? (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                    <CautionIcon size="0.9em" /> Ant needs 3 dry days
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-1.5">
                {day.rows.length ? (
                  <div className="flex flex-col gap-1">
                    {day.rows.map((r, i) => <RouteRow key={`${r.tech}-${i}`} r={r} />)}
                  </div>
                ) : day.fallback.length ? (
                  <div className="flex flex-col gap-1">
                    <div className="px-1 text-[10px] uppercase tracking-wide text-slate-600">not yet scheduled · Pocomos routes</div>
                    {day.fallback.map((f) => (
                      <div key={f.daycode} className="flex items-baseline justify-between rounded border border-slate-800 bg-slate-900/70 px-2 py-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="font-mono text-sm font-bold text-sky-300">{f.daycode}</span>
                          {f.ant ? <BugIcon size="0.85em" /> : null}
                          {f.electricBlower > 0 ? <BoltIcon size="0.85em" /> : null}
                          <span className="text-xs text-slate-400">{f.area}</span>
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-emerald-300">{f.stops}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-1 py-3 text-xs text-slate-600">No stops.</div>
                )}
              </div>
              {day.note ? (
                <div className="shrink-0 border-t border-slate-800 px-2 py-1 text-[11px] text-amber-300/80">
                  Notes: {day.note}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Right rail: announcements, new-customer box, shout-outs */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">Announcements</div>
            <div className="mt-2 text-sm">
              <div className="font-semibold text-slate-200">This week</div>
              <div className="whitespace-pre-wrap text-slate-300">{board.announcements.thisWeek || "—"}</div>
              <div className="mt-2 font-semibold text-slate-200">Next week</div>
              <div className="whitespace-pre-wrap text-slate-300">{board.announcements.nextWeek || "—"}</div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-amber-950/10 p-3">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">New customers — 1st spray</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">
              <li>Natural OR synthetic: get a bag.</li>
              <li>Synthetic: Neighbor Notification Card — 1&nbsp;oz per gallon of Permethrin.</li>
            </ol>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              <MegaphoneIcon size="1.1em" /> Shout-outs
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              {shownShouts.length ? (
                shownShouts.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
                    <div className="text-sm font-semibold text-emerald-300">{s.technician}</div>
                    <div className="text-sm text-slate-200">{s.body}</div>
                    <div className="text-[11px] text-slate-500">
                      — {s.fromName}{s.customerName ? ` · ${s.customerName}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-600">No shout-outs this week.</div>
              )}
            </div>
            {shoutPages > 1 && !interactive ? <ShoutRotator onTick={() => setShoutIdx((i) => i + 1)} /> : null}
          </div>

          {extras}
        </div>
      </div>
    </div>
  );
}

/** Rotate the shout-outs panel every 12s (TV only). */
function ShoutRotator({ onTick }: { onTick: () => void }) {
  useEffect(() => {
    const t = setInterval(onTick, 12000);
    return () => clearInterval(t);
  }, [onTick]);
  return null;
}
