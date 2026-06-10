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
import type { OverdueReport, MosquitoStatusRow } from "@/lib/service/refresh";

const POCOMOS_BASE = "https://mypocomos.net";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

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
                  bulk · {fmt(meta.scraped)}/{fmt(meta.addOn)} add-ons scraped
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
        everyone reads as overdue — that&rsquo;s expected.
      </p>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Stat label="Overdue" value={fmt(counts.overdue)} accent />
        <Stat label="Current" value={fmt(counts.current)} />
        <Stat label="Needs manual check" value={fmt(counts.needsCheck)} />
        <Stat label="Eligible (mosquito)" value={fmt(counts.total)} />
      </div>

      {/* Overdue table */}
      <Card>
        <CardHeader>
          <CardTitle>Overdue — no mosquito service in 15+ days</CardTitle>
          <CardDescription>
            Sorted by days since last mosquito service (longest first). &ldquo;No
            spray yet&rdquo; accounts (a 2026 signup awaiting their first
            service) are pinned to the top.
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
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${
          accent ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RowTable({
  rows,
  kind,
}: {
  rows: MosquitoStatusRow[];
  kind: "overdue" | "needsCheck";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Contract</th>
            {kind === "overdue" ? (
              <>
                <th className="py-2 pr-4 font-medium">Last mosquito service</th>
                <th className="py-2 pr-4 text-right font-medium">Days since</th>
              </>
            ) : (
              <th className="py-2 pr-4 font-medium">Selected contract</th>
            )}
            <th className="py-2 pl-4 text-right font-medium">Pocomos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pocomos_id} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{r.full_name || r.pocomos_id}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.mosquito_contract_type || "—"}
              </td>
              {kind === "overdue" ? (
                <>
                  <td className="py-2 pr-4 tabular-nums">
                    {r.last_regular_spray ?? (
                      <span className="text-rose-600 dark:text-rose-400">
                        no spray yet
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                    {r.days_since == null ? "—" : fmt(r.days_since)}
                  </td>
                </>
              ) : (
                <td className="py-2 pr-4 text-muted-foreground">
                  {r.selected_contract_label || "—"}
                </td>
              )}
              <td className="py-2 pl-4 text-right">
                <a
                  href={`${POCOMOS_BASE}/customer/${r.pocomos_id}/service-history`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
