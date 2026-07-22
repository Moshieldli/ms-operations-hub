"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DollarSign, Square, Volume2, VolumeX } from "lucide-react";
import { PausedBalanceCard, money } from "@/components/service-rows";
import type { MosquitoStatusRow } from "@/lib/service/refresh";

/**
 * /finance paused-balance section with the CASH-REGISTER moment (rev 55).
 * Display-only — the hub never touches payments; staff run cards in Pocomos and
 * this component only NOTICES the balance hitting $0 and celebrates.
 *
 * Two detection paths, one ring-once log (balance_clearances):
 *   - PASSIVE: on load, clearances newer than a per-browser localStorage marker
 *     get one chime + flying amounts + a "Collected $X since you last looked"
 *     line, then the marker advances.
 *   - COLLECTIONS MODE: "Start collections session" → re-check balances on
 *     visibilitychange (staff tab back from Pocomos) + a ~20s fallback poll via
 *     POST /api/finance/collections-check. Fresh clears ring per-clear, the row
 *     flashes green and slides out, and a session tally accrues. Auto-stops
 *     after 10 min without activity. Starting the session is the user gesture
 *     that unlocks the AudioContext, so autoplay is a non-issue while it runs.
 *
 * Browser only — never on /tv/* (self-guarded like the feedback bubble).
 * Audio autoplay on the passive path may be blocked: the visual always runs,
 * and a "Replay sound" speaker affordance appears instead. Mute is persisted.
 */

const MARKER_KEY = "ms_clearance_seen";
const MUTE_KEY = "ms_register_muted";
const SESSION_KEY = "ms_collections_session";
const POLL_MS = 20_000;
const IDLE_STOP_MS = 10 * 60 * 1000;
/** Row flash-and-slide duration before the row is actually removed. */
const ROW_CLEAR_MS = 950;

interface ClearedEntry {
  pocomosId: string;
  fullName: string | null;
  amount: number;
  fresh: boolean;
}

/** "Jane Doe" → "Jane D." (keeps the flyer short). */
function shortName(full: string | null): string {
  if (!full) return "customer";
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Short synthesized cash-register "cha-ching" — two bell tones, no asset file. */
function chaChing(ctx: AudioContext) {
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.2;
  master.connect(ctx.destination);
  const bell = (freq: number, start: number, dur: number, vol: number) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    const sg = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(vol, t + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    sg.gain.setValueAtTime(0.0001, t + start);
    sg.gain.exponentialRampToValueAtTime(vol * 0.3, t + start + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + start + dur * 0.7);
    o.connect(g);
    g.connect(master);
    shimmer.connect(sg);
    sg.connect(master);
    o.start(t + start);
    o.stop(t + start + dur + 0.05);
    shimmer.start(t + start);
    shimmer.stop(t + start + dur + 0.05);
  };
  bell(987.77, 0, 0.4, 0.85); // B5 — "cha"
  bell(1318.51, 0.09, 0.55, 1); // E6 — "ching"
}

export function FinancePausedSection({
  initialRows,
  asOf,
}: {
  initialRows: MosquitoStatusRow[];
  asOf?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [rows, setRows] = useState(initialRows);
  const [clearingIds, setClearingIds] = useState<Set<string>>(new Set());
  const [flyers, setFlyers] = useState<Array<{ key: number; label: string }>>([]);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [session, setSession] = useState(false);
  const [tally, setTally] = useState({ amount: 0, count: 0 });
  const [sinceLine, setSinceLine] = useState<{ amount: number; count: number } | null>(null);
  const [sessionNote, setSessionNote] = useState<string | null>(null);

  const audioRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const sessionRef = useRef(false);
  const checkingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const flyerKeyRef = useRef(0);

  const isTv = pathname?.startsWith("/tv") ?? false;

  const ensureAudio = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioRef.current) audioRef.current = new Ctor();
    return audioRef.current;
  }, []);

  /** Attempt the chime; if the context stays suspended (autoplay), show the affordance. */
  const playChime = useCallback(() => {
    if (mutedRef.current) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (ctx.state === "suspended") setAudioBlocked(true);
        else {
          setAudioBlocked(false);
          chaChing(ctx);
        }
      });
      // resume() may neither resolve nor unlock without a gesture — mark blocked
      // so the affordance shows; a later successful play clears it.
      setAudioBlocked(true);
      return;
    }
    setAudioBlocked(false);
    chaChing(ctx);
  }, [ensureAudio]);

  const spawnFlyer = useCallback((label: string, delayMs: number) => {
    window.setTimeout(() => {
      const key = ++flyerKeyRef.current;
      setFlyers((prev) => [...prev, { key, label }]);
      window.setTimeout(() => setFlyers((prev) => prev.filter((f) => f.key !== key)), 2600);
    }, delayMs);
  }, []);

  /** Animate a roster row out (green flash → slide), then drop it from state. */
  const clearRow = useCallback((pocomosId: string) => {
    setClearingIds((prev) => {
      const n = new Set(prev);
      n.add(pocomosId);
      return n;
    });
    window.setTimeout(() => {
      setRows((prev) => prev.filter((r) => r.pocomos_id !== pocomosId));
      setClearingIds((prev) => {
        const n = new Set(prev);
        n.delete(pocomosId);
        return n;
      });
    }, ROW_CLEAR_MS);
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ---- One Collections-Mode check (visibilitychange + poll both land here). ----
  const runCheck = useCallback(async () => {
    if (checkingRef.current || !sessionRef.current) return;
    checkingRef.current = true;
    try {
      const res = await fetch("/api/finance/collections-check", { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        busy?: boolean;
        cleared?: ClearedEntry[];
        partials?: Array<{ pocomosId: string; balance: number }>;
        serverNow?: string;
      };
      if (!json.ok || json.busy) return;
      const cleared = json.cleared ?? [];
      const fresh = cleared.filter((c) => c.fresh);
      if (fresh.length) {
        lastActivityRef.current = Date.now();
        playChime();
        fresh.forEach((c, i) => spawnFlyer(`+${money(c.amount)} — ${shortName(c.fullName)}`, i * 260));
        setTally((prev) => ({
          amount: prev.amount + fresh.reduce((s, c) => s + c.amount, 0),
          count: prev.count + fresh.length,
        }));
      }
      // Every clear leaves the roster (fresh or already logged by the refresh).
      for (const c of cleared) clearRow(c.pocomosId);
      for (const p of json.partials ?? []) {
        setRows((prev) =>
          prev.map((r) => (r.pocomos_id === p.pocomosId ? { ...r, open_balance: p.balance } : r))
        );
      }
      // Advance the passive marker so tomorrow doesn't re-celebrate what the
      // session already rang.
      if ((fresh.length || cleared.length) && json.serverNow) {
        try {
          localStorage.setItem(MARKER_KEY, json.serverNow);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* transient network failure — next tick retries */
    } finally {
      checkingRef.current = false;
    }
  }, [playChime, spawnFlyer, clearRow]);

  const stopSession = useCallback((note: string | null) => {
    setSession(false);
    sessionRef.current = false;
    setSessionNote(note);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const startSession = useCallback(() => {
    setSessionNote(null);
    setTally({ amount: 0, count: 0 });
    setSession(true);
    sessionRef.current = true;
    lastActivityRef.current = Date.now();
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    // The click IS the user gesture — unlock the AudioContext now so every
    // later ring plays without an autoplay fight.
    const ctx = ensureAudio();
    if (ctx) {
      void ctx.resume().then(() => setAudioBlocked(false));
    }
    void runCheck();
  }, [ensureAudio, runCheck]);

  // ---- Mount: restore prefs, resume a per-tab session, run the PASSIVE path. ----
  useEffect(() => {
    if (isTv) return;
    try {
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
      mutedRef.current = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* ignore */
    }
    let resumed = false;
    try {
      resumed = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (resumed) {
      setSession(true);
      sessionRef.current = true;
      lastActivityRef.current = Date.now();
    }

    let marker: string | null = null;
    try {
      marker = localStorage.getItem(MARKER_KEY);
    } catch {
      /* ignore */
    }
    const url = marker
      ? `/api/finance/clearances?since=${encodeURIComponent(marker)}`
      : "/api/finance/clearances";
    void fetch(url)
      .then((r) => r.json())
      .then(
        (json: {
          ok: boolean;
          items?: Array<{ pocomosId: string; fullName: string | null; amountCleared: number }>;
          serverNow?: string;
        }) => {
          if (!json.ok || !json.serverNow) return;
          try {
            localStorage.setItem(MARKER_KEY, json.serverNow);
          } catch {
            /* ignore */
          }
          // First visit (no marker): initialize silently — celebrating a month
          // of history would be noise, not news.
          if (!marker) return;
          const items = json.items ?? [];
          if (!items.length) return;
          setSinceLine({
            amount: items.reduce((s, i) => s + i.amountCleared, 0),
            count: items.length,
          });
          playChime();
          items
            .slice(0, 8)
            .forEach((c, i) =>
              spawnFlyer(`+${money(c.amountCleared)} — ${shortName(c.fullName)}`, i * 260)
            );
        }
      )
      .catch(() => {
        /* celebration is garnish — never break the page */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTv]);

  // ---- Session loop: visibilitychange + 20s fallback poll + 10-min idle stop. ----
  useEffect(() => {
    if (isTv || !session) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
        void runCheck();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_STOP_MS) {
        stopSession("Session auto-ended after 10 quiet minutes.");
        return;
      }
      void runCheck();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [isTv, session, runCheck, stopSession]);

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

  // TV kiosks get the plain card — no sound, no session, no celebration.
  if (isTv) {
    return <PausedBalanceCard rows={rows} asOf={asOf} />;
  }

  const headerExtra = (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {audioBlocked && !muted ? (
          <button
            type="button"
            onClick={() => {
              const ctx = ensureAudio();
              if (!ctx) return;
              void ctx.resume().then(() => {
                setAudioBlocked(false);
                chaChing(ctx);
              });
            }}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            title="The browser blocked autoplay — click to hear it"
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            Replay sound
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute cash-register sound" : "Mute cash-register sound"}
          title={muted ? "Unmute cash-register sound" : "Mute cash-register sound"}
          className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted"
        >
          {muted ? (
            <VolumeX className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        {session ? (
          /* LIVE state (rev 61): an unmistakable active panel — pulsing dot,
             running tally, and a clearly separate Stop — not a toggled label. */
          <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 py-2 pl-4 pr-2 dark:bg-emerald-950/40">
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight text-emerald-800 dark:text-emerald-300">
                Collections session LIVE
              </span>
              <span className="block text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                This session: {money(tally.amount)} · {tally.count} customer
                {tally.count === 1 ? "" : "s"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => stopSession(null)}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-background px-3 py-2 text-xs font-semibold hover:bg-muted"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
              Stop
            </button>
          </div>
        ) : (
          /* Idle state (rev 61): THE primary action on the page — big emerald
             gradient, soft glow pulse (off under prefers-reduced-motion). */
          <button
            type="button"
            onClick={startSession}
            title="Re-checks balances every time you tab back from Pocomos (plus every 20s)"
            className="ms-collect-cta group inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3 text-left text-white shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
              <DollarSign className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold leading-tight">
                Start collections session
              </span>
              <span className="block text-xs text-emerald-100">
                Ring the register as payments land
              </span>
            </span>
          </button>
        )}
      </div>
      {sessionNote ? <span className="text-xs text-muted-foreground">{sessionNote}</span> : null}
      {sinceLine ? (
        <span className="text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
          Collected {money(sinceLine.amount)} since you last looked ({sinceLine.count} customer
          {sinceLine.count === 1 ? "" : "s"})
        </span>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Animation styles — keyframes + prefers-reduced-motion fallbacks. */}
      <style>{`
        @keyframes msRowClear {
          0% { background-color: rgb(16 185 129 / 0.30); opacity: 1; transform: translateX(0); }
          40% { background-color: rgb(16 185 129 / 0.18); opacity: 1; transform: translateX(0); }
          100% { background-color: rgb(16 185 129 / 0.04); opacity: 0; transform: translateX(48px); }
        }
        tr.ms-row-clearing { animation: msRowClear 0.9s ease-in forwards; }
        @keyframes msFly {
          0% { opacity: 0; transform: translateY(10px) scale(0.9); }
          12% { opacity: 1; transform: translateY(0) scale(1); }
          75% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-120px); }
        }
        .ms-flyer { animation: msFly 2.4s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          tr.ms-row-clearing { animation: none; opacity: 0.25; }
          .ms-flyer { animation: msFlyFade 2.4s ease-out forwards; }
        }
        @keyframes msFlyFade { 0% { opacity: 0; } 15% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes msGlowPulse {
          0%, 100% { box-shadow: 0 4px 14px rgb(16 185 129 / 0.35); }
          50% { box-shadow: 0 4px 26px rgb(16 185 129 / 0.65); }
        }
        .ms-collect-cta { animation: msGlowPulse 2.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ms-collect-cta { animation: none; } }
      `}</style>

      {/* Flying dollar amounts (pointer-transparent overlay). */}
      {flyers.length ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex flex-col items-center gap-1"
        >
          {flyers.map((f) => (
            <span
              key={f.key}
              className="ms-flyer text-2xl font-bold tracking-tight text-emerald-600 drop-shadow-sm dark:text-emerald-400"
            >
              {f.label}
            </span>
          ))}
        </div>
      ) : null}

      <PausedBalanceCard
        rows={rows}
        asOf={asOf}
        headerExtra={headerExtra}
        rowExtraClass={(r) => (clearingIds.has(r.pocomos_id) ? "ms-row-clearing" : "")}
      />
    </>
  );
}
