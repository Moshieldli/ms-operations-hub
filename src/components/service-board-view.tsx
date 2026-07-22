"use client";

import { useEffect, useState } from "react";
import { TvBoardView, type Shoutout } from "@/components/tv-board-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ScheduleBoard } from "@/lib/service/scheduleBoard";

const NAME_KEY = "ms_feedback_name"; // shared with the feedback bubble
const SHOUT_MAX = 160;

type ManagedShout = Shoutout & { hidden: boolean };

/**
 * `/service/board` (rev 50) — the browser view of the route board plus the
 * controls the TV can't have: edit announcements, post a shout-out, and
 * hide/restore shout-outs. The board mirror itself is the shared `TvBoardView`.
 */
export function ServiceBoardView({
  board,
  roster,
  shoutouts: initialShouts,
}: {
  board: ScheduleBoard | null;
  roster: string[];
  shoutouts: ManagedShout[];
}) {
  const [shouts, setShouts] = useState<ManagedShout[]>(initialShouts);
  const active = shouts.filter((s) => !s.hidden);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Route board</h1>
        <a href="/tv/board" target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted">
          TV mode
        </a>
      </div>

      {/* The board mirror (dark, like the TV). */}
      <div className="overflow-hidden rounded-xl border">
        <TvBoardView board={board} shoutouts={active} interactive />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AnnouncementEditor
          initial={board?.announcements ?? { thisWeek: "", nextWeek: "", urgent: "" }}
        />
        <ShoutoutForm roster={roster} onCreated={(s) => setShouts((p) => [s, ...p])} />
      </div>

      <ShoutoutManager shouts={shouts} onToggle={(id, hidden) =>
        setShouts((p) => p.map((s) => (s.id === id ? { ...s, hidden } : s)))
      } />
    </div>
  );
}

function AnnouncementEditor({
  initial,
}: {
  initial: { thisWeek: string; nextWeek: string; urgent: string };
}) {
  const [thisWeek, setThisWeek] = useState(initial.thisWeek);
  const [nextWeek, setNextWeek] = useState(initial.nextWeek);
  const [urgent, setUrgent] = useState(initial.urgent);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/board/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thisWeek, nextWeek, urgent }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save failed");
      setNote("Saved.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Announcements</CardTitle>
        <CardDescription>THIS WEEK / NEXT WEEK — natural vs synthetic, shown on the board.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
          Urgent announcement — big red banner on BOTH boards; leave empty for none
        </label>
        <input
          value={urgent}
          onChange={(e) => setUrgent(e.target.value.slice(0, 300))}
          placeholder="MON MORNING MEETINGS!"
          className="w-full rounded-md border-2 border-red-300 bg-background px-2.5 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-red-400 dark:border-red-800"
        />
        <label className="block text-xs font-medium text-muted-foreground">This week</label>
        <textarea value={thisWeek} onChange={(e) => setThisWeek(e.target.value)} rows={2}
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <label className="block text-xs font-medium text-muted-foreground">Next week</label>
        <textarea value={nextWeek} onChange={(e) => setNextWeek(e.target.value)} rows={2}
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy} variant="outline">{busy ? "Saving…" : "Save"}</Button>
          {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ShoutoutForm({ roster, onCreated }: { roster: string[]; onCreated: (s: ManagedShout) => void }) {
  const [tech, setTech] = useState("");
  const [body, setBody] = useState("");
  const [fromName, setFromName] = useState("");
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(NAME_KEY); if (s) setFromName(s); } catch { /* ignore */ }
  }, []);

  const submit = async () => {
    if (!tech) return setNote("Pick a technician.");
    if (!body.trim()) return setNote("Add a shout-out.");
    if (!fromName.trim()) return setNote("Add your name.");
    try { localStorage.setItem(NAME_KEY, fromName.trim()); } catch { /* ignore */ }
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/compliments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technician: tech, body, fromName, customerName: customer }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      onCreated({
        id: j.id, technician: tech, body: body.trim(), fromName: fromName.trim(),
        customerName: customer.trim() || null, createdAt: new Date().toISOString().slice(0, 19).replace("T", " "),
        hidden: false,
      });
      setBody(""); setCustomer(""); setNote("Sent!");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Give a shout-out</CardTitle>
        <CardDescription>Recognize a teammate — shows on the board for 7 days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <select value={tech} onChange={(e) => setTech(e.target.value)}
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm">
          <option value="">Technician…</option>
          {roster.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, SHOUT_MAX))} rows={2}
          placeholder="What did they do great?"
          className="w-full resize-none rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <div className="text-right text-[11px] text-muted-foreground">{body.length}/{SHOUT_MAX}</div>
        <div className="grid grid-cols-2 gap-2">
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your name (required)"
            className="rounded-md border bg-background px-2.5 py-1.5 text-sm" />
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer (optional)"
            className="rounded-md border bg-background px-2.5 py-1.5 text-sm" />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : "Post shout-out"}</Button>
          {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ShoutoutManager({ shouts, onToggle }: { shouts: ManagedShout[]; onToggle: (id: number, hidden: boolean) => void }) {
  const toggle = async (id: number, hidden: boolean) => {
    onToggle(id, hidden);
    try {
      await fetch(`/api/compliments/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
    } catch {
      onToggle(id, !hidden); // revert
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage shout-outs</CardTitle>
        <CardDescription>Hide anything that shouldn&rsquo;t be on the board. Hidden ones never show.</CardDescription>
      </CardHeader>
      <CardContent>
        {shouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shout-outs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {shouts.map((s) => (
              <div key={s.id} className={`flex items-start justify-between gap-3 rounded-md border p-2 text-sm ${s.hidden ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <span className="font-semibold">{s.technician}</span> — {s.body}
                  <div className="text-xs text-muted-foreground">
                    {s.createdAt.slice(0, 10)} · {s.fromName}{s.customerName ? ` · ${s.customerName}` : ""}
                  </div>
                </div>
                <button onClick={() => toggle(s.id, !s.hidden)}
                  className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted">
                  {s.hidden ? "Restore" : "Hide"}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
