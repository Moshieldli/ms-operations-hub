"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { FollowupBucket, FollowupLead, FollowupReport } from "@/lib/leads/followup";
import { cn } from "@/lib/utils";

const toneClass = (tone: "bad" | "warn" | "ok") =>
  tone === "bad"
    ? "text-red-600 dark:text-red-400"
    : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "";

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
    key: "never_reached",
    label: "Never reached",
    def: "No task ever AND no notes this year — for-sure missed. The worst bucket.",
    tone: "bad",
  },
  {
    key: "loop_not_closed",
    label: "Loop not closed",
    def: "Reached (notes/activity) but no task ever completed and none in progress. Review and create a closing task.",
    tone: "warn",
  },
  {
    key: "closed_out",
    label: "Closed out",
    def: "A task was completed and none is in progress — done reaching out; the closing description is the outcome.",
    tone: "ok",
  },
  {
    key: "working_overdue",
    label: "Working — overdue",
    def: "In-progress task, but its due date has passed. Being worked, just behind.",
    tone: "warn",
  },
  {
    key: "working_on_track",
    label: "Working — on track",
    def: "In-progress task, due today or later.",
    tone: "ok",
  },
];

export function FollowupView({ initial }: { initial: FollowupReport }) {
  const [report, setReport] = useState<FollowupReport>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
  const bucketRows = (k: FollowupBucket) => report.leads.filter((l) => l.bucket === k);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Lead follow-ups</CardTitle>
              <CardDescription>
                Open {report.year} leads by where their follow-up stands.{" "}
                <strong>Tasks and notes are separate</strong>: an in-progress
                task means someone is actively working the lead; a{" "}
                <strong>completed</strong> task = done reaching out (its closing
                description is the outcome); <strong>notes</strong> are the record
                of contact. Click a category to open its list.{" "}
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
          <p className="text-xs text-muted-foreground">
            {fmt(c.scope)} open {report.year} leads in scope.{" "}
            {c.withPbActivity > 0 ? (
              <>
                <strong className="font-medium">{fmt(c.withPbActivity)}</strong> of the
                Never-reached / Loop-not-closed leads have PhoneBurner call
                activity — someone dialled them even though no task tracks it.
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      {/* One collapsible section per bucket — Never reached + Loop not closed
          open by default; click any header to open its list. */}
      <div className="space-y-2">
        {BUCKETS.map((b) => {
          const rows = bucketRows(b.key);
          return (
            <CollapsibleSection
              key={b.key}
              defaultOpen={b.key === "never_reached" || b.key === "loop_not_closed"}
              label={<span className={cn("font-medium", toneClass(b.tone))}>{b.label}</span>}
              right={<span className={cn("font-semibold tabular-nums", toneClass(b.tone))}>{fmt(rows.length)}</span>}
            >
              <p className="mb-2 text-[11px] leading-snug text-muted-foreground">{b.def}</p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : b.key === "closed_out" ? (
                <ClosedTable rows={rows} />
              ) : (
                <BucketTable rows={rows} />
              )}
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}

/** Standard follow-up table (never / loop / working buckets share these columns). */
function BucketTable({ rows }: { rows: FollowupLead[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Lead</th>
            <th className="py-2 pr-3 font-medium">Created</th>
            <th className="py-2 pr-3 font-medium">Salesperson</th>
            <th className="py-2 pr-3 text-right font-medium">Notes</th>
            <th className="py-2 pr-3 font-medium">Last note</th>
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
  );
}

/**
 * Closed-out table: a task was completed and none is in progress. Shows the
 * outcome (closing task description), completion date, salesperson, the
 * Not-Interested reason where set, and a link to the lead.
 */
function ClosedTable({ rows }: { rows: FollowupLead[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Lead</th>
            <th className="py-2 pr-3 font-medium">Closed</th>
            <th className="py-2 pr-3 font-medium">Salesperson</th>
            <th className="py-2 pr-3 font-medium">What they closed with</th>
            <th className="py-2 pr-3 font-medium">Not-Interested reason</th>
            <th className="py-2 pl-3 text-right font-medium">Pocomos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.leadId} className="border-b align-top last:border-0">
              <td className="py-2 pr-3">
                <div className="font-medium">{l.name}</div>
                <div className="text-[11px] tabular-nums text-muted-foreground">{l.leadId}</div>
              </td>
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.completedAt)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{l.salesperson || "—"}</td>
              <td className="py-2 pr-3 text-xs text-muted-foreground">{l.taskDescription || "—"}</td>
              <td className="py-2 pr-3 text-xs">
                {l.notInterestedReason ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {l.notInterestedReason}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ l }: { l: FollowupLead }) {
  const bad = l.bucket === "never_reached";
  return (
    <tr className={cn("border-b align-top last:border-0", bad && "bg-red-50/40 dark:bg-red-950/10")}>
      <td className="py-2 pr-3">
        <div className="font-medium">{l.name}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {l.leadId}
          {l.bucket === "never_reached" ? (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-950 dark:text-red-400">
              never reached
            </span>
          ) : null}
          {l.bucket === "loop_not_closed" ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              loop open
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.createdDate)}</td>
      <td className="py-2 pr-3 text-muted-foreground">{l.salesperson || "—"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{l.notesCount}</td>
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{dayOf(l.lastNoteAt)}</td>
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
