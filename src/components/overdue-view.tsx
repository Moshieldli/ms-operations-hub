"use client";

import { useCallback, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import type { OverdueReport } from "@/lib/service/refresh";
import { cn } from "@/lib/utils";
import { PausedBalanceCard, RowTable, fmt, money } from "@/components/service-rows";

// Status palette — meaningful color only (shared with the sales view):
// neutral = default, healthy = green, attention = amber, action = red.
const TONE = {
  neutral: "",
  healthy: "text-emerald-600 dark:text-emerald-400",
  attention: "text-amber-600 dark:text-amber-400",
  action: "text-rose-600 dark:text-rose-400",
} as const;
type Tone = keyof typeof TONE;

export function OverdueView({ initial }: { initial: OverdueReport }) {
  const [report, setReport] = useState<OverdueReport>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/service/overdue", { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; report?: OverdueReport };
    if (data.ok && data.report) setReport(data.report);
  }, []);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await fetch("/api/service/overdue", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        skipped?: boolean;
        reason?: string;
        error?: string;
      };
      if (data.ok && data.skipped) {
        setNote(data.reason || "A refresh is already running.");
      } else if (!data.ok) {
        setNote(data.error || "Refresh failed.");
      }
      await reload();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const { counts, meta, lastRefreshedAt } = report;

  return (
    <div className="space-y-6">
      {/* Toolbar: freshness + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {lastRefreshedAt ? (
            <>
              Last refreshed <RefreshedAt asOf={lastRefreshedAt} />
              {meta ? (
                <span className="opacity-70">
                  {" "}
                  · {fmt(meta.eligible)} eligible · {fmt(meta.mosquitoOnly)} via
                  bulk · {fmt(meta.scraped)} add-ons scraped
                  {meta.pausedBalance
                    ? ` · ${fmt(meta.pausedBalance)} paused (${money(
                        meta.openBalanceTotal
                      )} owed)`
                    : ""}
                  {meta.failed ? ` · ${meta.failed} failed` : ""}
                  {!meta.reachedEndOfQueue
                    ? " · partial run (more pending — run again)"
                    : ""}
                </span>
              ) : null}
            </>
          ) : (
            <>No data yet — run a refresh to populate the report.</>
          )}
        </div>
        <Button onClick={refreshNow} disabled={refreshing} size="sm">
          {refreshing ? "Refreshing… (this can take a few minutes)" : "Refresh now"}
        </Button>
      </div>

      {note ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {note}
        </div>
      ) : null}

      {/* In-season notice */}
      <p className="text-xs text-muted-foreground">
        In-season tool. During mosquito season this flags accounts that have
        slipped past their weekly cadence. Off-season (no one is being sprayed),
        everyone reads as overdue — that&rsquo;s expected. Accounts with an open
        balance are listed separately (spray is intentionally paused), and
        signups from the last {""}
        3 days are held back until a spray is actually due.
      </p>

      {/* Stat row — Overdue dominates (hero + action color); color is semantic */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Overdue"
          value={fmt(counts.overdue)}
          tone="action"
          size="hero"
          sub={
            [
              counts.sprayedToday
                ? `Excludes ${fmt(counts.sprayedToday)} sprayed today`
                : null,
              counts.scheduledToday
                ? `Excludes ${fmt(counts.scheduledToday)} scheduled for today`
                : null,
              counts.asapRoute ? `Excludes ${fmt(counts.asapRoute)} on ASAP route` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <Stat label="Paused (balance)" value={fmt(counts.pausedBalance)} tone="attention" />
        <Stat label="Current" value={fmt(counts.current)} tone="healthy" />
        <Stat label="Excluded (new)" value={fmt(counts.excludedNew)} />
        <Stat label="Needs manual check" value={fmt(counts.needsCheck)} tone="attention" />
        <Stat label="Eligible (mosquito)" value={fmt(counts.total)} />
      </div>

      {/* Overdue table */}
      <Card>
        <CardHeader>
          <CardTitle>Overdue — no mosquito service in 15+ days</CardTitle>
          <CardDescription>
            Sorted by days since last mosquito service (longest first). &ldquo;No
            spray yet&rdquo; accounts (a 2026 signup awaiting their first
            service) are pinned to the top. Accounts with an open balance are not
            here — see the paused section below. Accounts sprayed today,
            scheduled for today, or on an ASAP route are excluded from the count
            and listed below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No overdue customers. 🎉
            </p>
          ) : (
            <RowTable rows={report.overdue} kind="overdue" />
          )}
        </CardContent>
      </Card>

      {/* Sprayed today — overdue accounts that already got a completed mosquito
          service today (green), pulled out of the overdue table + count. Catches
          customers whose bulk next_service_date is a stale past slot, so the
          Scheduled-today rule can't see them. Rendered BELOW the overdue table. */}
      {report.sprayedToday.length > 0 ? (
        <Card className="border-emerald-300 dark:border-emerald-900/50">
          <CardHeader>
            <CardTitle className="text-emerald-700 dark:text-emerald-400">
              Sprayed today ({fmt(report.sprayedToday.length)})
            </CardTitle>
            <CardDescription>
              Accounts that already received a completed mosquito service today
              (from the completed-jobs report) — done, so excluded from the
              overdue count above. Their cached &ldquo;last spray&rdquo; may still
              read older until the next full refresh; the completion is what
              counts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RowTable rows={report.sprayedToday} kind="overdue" />
          </CardContent>
        </Card>
      ) : null}

      {/* Scheduled today — overdue accounts being serviced today (green), pulled
          out of the overdue table + count. Rendered BELOW the overdue table. */}
      {report.scheduledToday.length > 0 ? (
        <Card className="border-emerald-300 dark:border-emerald-900/50">
          <CardHeader>
            <CardTitle className="text-emerald-700 dark:text-emerald-400">
              Scheduled today ({fmt(report.scheduledToday.length)})
            </CardTitle>
            <CardDescription>
              Overdue accounts whose next mosquito service is scheduled for today
              — they&rsquo;re being handled today, so they&rsquo;re excluded from
              the overdue count above and listed here instead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RowTable rows={report.scheduledToday} kind="overdue" />
          </CardContent>
        </Card>
      ) : null}

      {/* On ASAP route — overdue accounts with an upcoming job assigned to an
          ASAP route (being caught up), pulled out of the overdue count. */}
      {report.asapRoute.length > 0 ? (
        <Card className="border-sky-300 dark:border-sky-900/50">
          <CardHeader>
            <CardTitle className="text-sky-700 dark:text-sky-400">
              On ASAP route ({fmt(report.asapRoute.length)})
            </CardTitle>
            <CardDescription>
              Overdue accounts with an upcoming job assigned to an ASAP route —
              they&rsquo;re being caught up, so they&rsquo;re excluded from the
              overdue count above and listed here instead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RowTable rows={report.asapRoute} kind="overdue" />
          </CardContent>
        </Card>
      ) : null}

      {/* Service paused — open balance (shared with /finance). */}
      <PausedBalanceCard rows={report.pausedBalance} />

      {/* Needs manual check */}
      <Card>
        <CardHeader>
          <CardTitle>Needs manual check</CardTitle>
          <CardDescription>
            Eligible mosquito customers whose currently-selected Pocomos contract
            isn&rsquo;t the mosquito one. We never switch contracts
            automatically — open them in Pocomos, switch to the mosquito
            contract, and read the history there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.needsCheck.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None — every eligible customer&rsquo;s mosquito contract was
              readable.
            </p>
          ) : (
            <RowTable rows={report.needsCheck} kind="needsCheck" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  size = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: Tone;
  size?: "default" | "hero";
  sub?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 sm:p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-semibold tabular-nums",
          size === "hero" ? "text-3xl sm:text-4xl" : "text-2xl",
          TONE[tone]
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] leading-snug text-emerald-700 dark:text-emerald-400">
          {sub}
        </div>
      ) : null}
    </div>
  );
}
