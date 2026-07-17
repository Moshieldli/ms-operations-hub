"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import type { FollowupBucket, FollowupLead, FollowupReport } from "@/lib/leads/followup";
import { cn } from "@/lib/utils";

const POCOMOS_BASE = "https://mypocomos.net";
const fmt = (n: number) => n.toLocaleString("en-US");

/** Lead message-board link — where the follow-up task actually lives. */
const boardUrl = (id: string) => `${POCOMOS_BASE}/lead/${id}/message-board`;

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

const BUCKETS: Array<{
  key: FollowupBucket;
  label: string;
  def: string;
  tone: "bad" | "warn" | "ok";
}> = [
  {
    key: "overdue",
    label: "Overdue",
    def: "Has an open follow-up task whose due date has passed.",
    tone: "bad",
  },
  {
    key: "no_task",
    label: "No task",
    def: "No follow-up task at all — active or archived. Nobody has ever set a next step.",
    tone: "bad",
  },
  {
    key: "no_open_task",
    label: "No open task",
    def: "Every task is completed and nothing new is scheduled — the lead is still open, but there's no next step.",
    tone: "warn",
  },
  {
    key: "on_track",
    label: "On track",
    def: "Open task due today or later.",
    tone: "ok",
  },
];

export function FollowupView({ initial }: { initial: FollowupReport }) {
  const [report, setReport] = useState<FollowupReport>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [show, setShow] = useState<FollowupBucket[]>(["overdue", "no_task"]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await fetch("/api/leads/followup", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "refresh failed");
      if (json.skipped) setNote("A refresh is already running — try again in a moment.");
      const fresh = await (await fetch("/api/leads/followup", { cache: "no-store" })).json();
      if (fresh.ok) setReport(fresh.report);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const c = report.counts;
  const rows = report.leads.filter((l) => show.includes(l.bucket));
  const toggle = (k: FollowupBucket) =>
    setShow((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Overdue follow-ups</CardTitle>
              <CardDescription>
                Open {report.year} leads and where their follow-up stands. A
                lead&rsquo;s next step lives in its Pocomos <strong>task</strong>;
                the team pushes the task&rsquo;s due date out after each touch, so
                a due date in the past means the trail went cold.{" "}
                {report.stale ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Cache is empty — hit Refresh now to build it.
                  </span>
                ) : (
                  <>
                    Cached · <RefreshedAt asOf={report.asOf} />
                  </>
                )}
              </CardDescription>
            </div>
            <Button onClick={refresh} disabled={refreshing} variant="outline">
              {refreshing ? "Refreshing…" : "Refresh now"}
            </Button>
          </div>
          {note ? <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{note}</p> : null}
        </CardHeader>
        <CardContent>
          {/* Stat boxes — click to filter the table. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BUCKETS.map((b) => {
              const n =
                b.key === "overdue" ? c.overdue
                : b.key === "no_task" ? c.noTask
                : b.key === "no_open_task" ? c.noOpenTask
                : c.onTrack;
              const on = show.includes(b.key);
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => toggle(b.key)}
                  title={b.def}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    on ? "bg-muted/60" : "hover:bg-muted/30",
                    !on && "opacity-60"
                  )}
                >
                  <div
                    className={cn(
                      "text-2xl font-semibold tabular-nums",
                      b.tone === "bad" && "text-red-600 dark:text-red-400",
                      b.tone === "warn" && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {fmt(n)}
                  </div>
                  <div className="mt-1 text-xs font-medium">{b.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{b.def}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {fmt(c.scope)} open {report.year} leads in scope · showing{" "}
            {fmt(rows.length)} (click a box to filter).{" "}
            {c.withPbActivity > 0 ? (
              <>
                <strong className="font-medium">{fmt(c.withPbActivity)}</strong> of the
                Overdue / No-task leads have PhoneBurner call activity — someone
                dialled them even though the task went stale.
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in the selected buckets. 🎉
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Lead</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 pr-3 font-medium">Salesperson</th>
                    <th className="py-2 pr-3 text-right font-medium">Touches</th>
                    <th className="py-2 pr-3 font-medium">Last touch</th>
                    <th className="py-2 pr-3 font-medium">Task due</th>
                    <th className="py-2 pr-3 text-right font-medium">Days overdue</th>
                    <th className="py-2 pr-3 font-medium">PB calls</th>
                    <th className="py-2 pr-3 font-medium">Marketing</th>
                    <th className="py-2 pl-3 text-right font-medium">Pocomos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <Row key={l.leadId} l={l} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ l }: { l: FollowupLead }) {
  const bad = l.bucket === "overdue" || l.bucket === "no_task";
  return (
    <tr className={cn("border-b align-top last:border-0", bad && "bg-red-50/40 dark:bg-red-950/10")}>
      <td className="py-2 pr-3">
        <div className="font-medium">{l.name}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {l.leadId}
          {l.bucket === "no_task" ? (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-950 dark:text-red-400">
              never followed up
            </span>
          ) : null}
          {l.bucket === "no_open_task" ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              no next step
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.createdDate)}</td>
      <td className="py-2 pr-3 text-muted-foreground">{l.salesperson || "—"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{l.touches}</td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.lastTouchAt)}</td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.taskDueAt)}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-medium">
        {l.daysOverdue != null ? (
          <span className="text-red-600 dark:text-red-400">{l.daysOverdue}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">
        {l.pbCalls > 0 ? (
          <span
            className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            title={`Last PhoneBurner call ${dayOf(l.pbLastCallAt)}`}
          >
            {l.pbCalls} · {dayOf(l.pbLastCallAt)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{l.marketingType || "—"}</td>
      <td className="py-2 pl-3 text-right">
        <a
          href={boardUrl(l.leadId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          Message board
        </a>
      </td>
    </tr>
  );
}
