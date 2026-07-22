"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * New-sale bell (rev 60, §5.22). Watches the live `buckets.NEW` count (the
 * same series `snapshots.new_count` is written from — NOT the taxonomy tile,
 * which is a different definition and can't be diffed against snapshots):
 *
 *  - count CLIMBS by N → sale.wav + "+N NEW SALE" splash + New-tile flash;
 *  - weekly tally = live NEW − new_count at the week-start Saturday snapshot
 *    (Sat–Fri SALES week — distinct from the Sun–Fri service week);
 *  - tally crosses 10 / 25 → milestone sound instead (never both), fired
 *    once per week (persisted server-side, kiosk reloads can't re-ring);
 *  - count DROPS (tag corrections) → silence, just update.
 *
 * Sounds only where `sound: true` (/tv/sales — a real Chrome kiosk, not
 * Yodeck). /sales renders the tally silently. Autoplay-blocked → visual runs,
 * an "Enable sound" affordance appears (one-time per kiosk; or set Chrome's
 * site permission Sound=Allow for set-and-forget). Mute persisted.
 */

const GOAL = 25;
const MID_MILESTONE = 10;
const LASTSEEN_KEY = "ms_sale_lastseen";
const MUTE_KEY = "ms_salebell_muted";
const SOUND_FILES = { sale: "/sounds/sale.wav", m10: "/sounds/milestone-10.wav", m25: "/sounds/milestone-25.wav" };

interface WeekState {
  weekStart: string;
  baselineNew: number;
  fired: number[];
}

export interface SaleBellState {
  /** Sales this week (display-clamped ≥ 0), or null before the baseline loads. */
  tally: number | null;
  goal: number;
  /** Active celebration (splash text + tile flash), null when idle. */
  splash: { delta: number; milestone: number | null } | null;
  muted: boolean;
  toggleMute: () => void;
  audioBlocked: boolean;
  enableSound: () => void;
  /** Which sound file last attempted to play (testability + debugging). */
  lastPlayed: string | null;
}

export function useSaleBell(newCount: number | null, opts: { sound: boolean }): SaleBellState {
  const [week, setWeek] = useState<WeekState | null>(null);
  // Climb handling WAITS for the week fetch to settle — otherwise a climb that
  // lands during the first render races the baseline and can't see milestones.
  const [weekStatus, setWeekStatus] = useState<"pending" | "ready" | "error">("pending");
  const [splash, setSplash] = useState<SaleBellState["splash"]>(null);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const prevRef = useRef<number | null>(null);
  const weekRef = useRef<WeekState | null>(null);
  const mutedRef = useRef(false);
  const splashTimer = useRef<number | null>(null);

  useEffect(() => {
    weekRef.current = week;
  }, [week]);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MUTE_KEY) === "1";
      setMuted(m);
      mutedRef.current = m;
    } catch {
      /* ignore */
    }
    void fetch("/api/sales/week-tally", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok: boolean } & WeekState) => {
        if (j.ok) {
          setWeek({ weekStart: j.weekStart, baselineNew: j.baselineNew, fired: j.fired });
          setWeekStatus("ready");
        } else setWeekStatus("error");
      })
      .catch(() => {
        setWeekStatus("error"); // tally stays hidden; plain bell still rings
      });
  }, []);

  const play = useCallback(
    (file: string) => {
      setLastPlayed(file);
      if (!opts.sound || mutedRef.current) return;
      const audio = new Audio(file);
      audio.play().then(
        () => setAudioBlocked(false),
        () => setAudioBlocked(true) // autoplay blocked — visual continues
      );
    },
    [opts.sound]
  );

  // Climb detection on every live value (and again once the week settles).
  useEffect(() => {
    if (newCount == null || weekStatus === "pending") return;
    if (prevRef.current == null) {
      // First observation: resume from the kiosk's last-seen count so sales
      // that landed while the tab was closed still ring ONCE — but a plain
      // reload doesn't re-ring old ones.
      let stored: number | null = null;
      try {
        const raw = localStorage.getItem(LASTSEEN_KEY);
        stored = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
      } catch {
        /* ignore */
      }
      prevRef.current = stored ?? newCount;
    }
    const prev = prevRef.current;
    if (newCount > prev) {
      const delta = newCount - prev;
      const w = weekRef.current;
      let milestone: number | null = null;
      if (w) {
        const tallyFrom = prev - w.baselineNew;
        const tallyTo = newCount - w.baselineNew;
        if (tallyFrom < GOAL && tallyTo >= GOAL && !w.fired.includes(GOAL)) milestone = GOAL;
        else if (tallyFrom < MID_MILESTONE && tallyTo >= MID_MILESTONE && !w.fired.includes(MID_MILESTONE))
          milestone = MID_MILESTONE;
      }
      if (milestone) {
        // Milestone sound ONLY (never layered on the +1 bell).
        play(milestone === GOAL ? SOUND_FILES.m25 : SOUND_FILES.m10);
        setWeek((cur) => (cur ? { ...cur, fired: [...cur.fired, milestone!] } : cur));
        void fetch("/api/sales/week-tally", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestone }),
        }).catch(() => {
          /* re-fires at worst on next crossing attempt — GET refreshes fired[] */
        });
      } else {
        play(SOUND_FILES.sale);
      }
      setSplash({ delta, milestone });
      if (splashTimer.current != null) window.clearTimeout(splashTimer.current);
      splashTimer.current = window.setTimeout(
        () => setSplash(null),
        milestone ? 8000 : 5000
      );
    }
    // Drops (tag corrections): silence — just remember the new value.
    prevRef.current = newCount;
    try {
      localStorage.setItem(LASTSEEN_KEY, String(newCount));
    } catch {
      /* ignore */
    }
  }, [newCount, weekStatus, play]);

  useEffect(() => {
    return () => {
      if (splashTimer.current != null) window.clearTimeout(splashTimer.current);
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /** User gesture → play a zero-volume unlock so later rings are allowed. */
  const enableSound = useCallback(() => {
    const audio = new Audio(SOUND_FILES.sale);
    audio.volume = 0;
    audio.play().then(
      () => {
        audio.pause();
        setAudioBlocked(false);
      },
      () => setAudioBlocked(true)
    );
  }, []);

  const tally =
    newCount != null && week ? Math.max(0, newCount - week.baselineNew) : null;

  return { tally, goal: GOAL, splash, muted, toggleMute, audioBlocked, enableSound, lastPlayed };
}

/** "This week: X / 25" tally line (both boards; subtle on /sales). */
export function WeekTallyLine({ bell, subtle }: { bell: SaleBellState; subtle?: boolean }) {
  if (bell.tally == null) return null;
  const hit = bell.tally >= bell.goal;
  return (
    <span
      className={
        subtle
          ? "text-xs tabular-nums text-muted-foreground"
          : `text-base tabular-nums lg:text-lg ${hit ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`
      }
      title="New sales this Sat–Fri week vs the weekly goal"
    >
      This week: {bell.tally} / {bell.goal}
    </span>
  );
}

/** Full-screen "+N NEW SALE" splash + sound affordances (TV only). */
export function SaleBellOverlay({ bell }: { bell: SaleBellState }) {
  return (
    <>
      <style>{`
        @keyframes msSaleSplash {
          0% { opacity: 0; transform: scale(0.7); }
          12% { opacity: 1; transform: scale(1.06); }
          18% { transform: scale(1); }
          85% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.02); }
        }
        .ms-sale-splash { animation: msSaleSplash 5s ease-out forwards; }
        .ms-sale-splash--big { animation-duration: 8s; }
        @media (prefers-reduced-motion: reduce) {
          .ms-sale-splash, .ms-sale-splash--big { animation: none; }
        }
      `}</style>
      {bell.splash ? (
        <div
          data-last-played={bell.lastPlayed ?? ""}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70"
        >
          <div
            className={`ms-sale-splash ${bell.splash.milestone ? "ms-sale-splash--big" : ""} flex flex-col items-center gap-4 text-center`}
          >
            <BellIcon className="h-24 w-24 text-emerald-500" />
            <div className="text-7xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 lg:text-8xl">
              +{bell.splash.delta} NEW SALE{bell.splash.delta > 1 ? "S" : ""}
            </div>
            {bell.splash.milestone ? (
              <div className="text-4xl font-semibold text-amber-500 lg:text-5xl">
                {bell.splash.milestone} THIS WEEK{bell.splash.milestone >= 25 ? " — GOAL HIT" : ""}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* Corner controls: mute (persisted) + one-time enable-sound affordance. */}
      <div className="fixed bottom-3 right-3 z-40 flex items-center gap-2">
        {bell.audioBlocked && !bell.muted ? (
          <button
            type="button"
            onClick={bell.enableSound}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground shadow hover:bg-muted"
            title="Chrome blocked autoplay — click once to enable sound (or set the site's Sound permission to Allow)"
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            Enable sound
          </button>
        ) : null}
        <button
          type="button"
          onClick={bell.toggleMute}
          aria-label={bell.muted ? "Unmute sale bell" : "Mute sale bell"}
          className="pointer-events-auto rounded-md border bg-background p-1.5 text-muted-foreground opacity-60 shadow hover:bg-muted hover:opacity-100"
        >
          {bell.muted ? (
            <VolumeX className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
