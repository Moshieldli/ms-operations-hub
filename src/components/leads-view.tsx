"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import type { LeadsCloseRateReport, RepRow } from "@/lib/leads/closeRate";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}
function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

type SortKey = "salesperson" | "leads" | "conversions" | "closeRate";

export function LeadsView({ initial }: { initial: LeadsCloseRateReport | null }) {
  const [report, setReport] = useState<LeadsCloseRateReport | null>(initial);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [start, setStart] = useState(initial?.periodStart ?? `${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(
    initial?.periodEnd ??
      new Date().toISOString().slice(0, 10)
  );
  const [sortKey, setSortKey] = useState<SortKey>("leads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // If we landed with no cached report, compute the default period once.
  const loadDefault = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch("/api/leads/close-rate", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; report?: LeadsCloseRateReport; error?: string };
      if (data.ok && data.report) {
        setReport(data.report);
        setStart(data.report.periodStart);
        setEnd(data.report.periodEnd);
      } else setNote(data.error || "Failed to load.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) loadDefault();
  }, [initial, loadDefault]);

  const applyRange = useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch(
        `/api/leads/close-rate?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { ok: boolean; report?: LeadsCloseRateReport; error?: string };
      if (data.ok && data.report) setReport(data.report);
      else setNote(data.error || "Failed to compute range.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await fetch("/api/leads/close-rate", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        report?: LeadsCloseRateReport;
        skipped?: boolean;
        reason?: string;
        error?: string;
      };
      if (data.ok && data.skipped) setNote(data.reason || "A refresh is already running.");
      else if (data.ok && data.report) {
        setReport(data.report);
        setStart(data.report.periodStart);
        setEnd(data.report.periodEnd);
      } else if (!data.ok) setNote(data.error || "Refresh failed.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sortedReps = useMemo(() => {
    if (!report) return [];
    const arr = [...report.reps];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "salesperson") cmp = a.salesperson.localeCompare(b.salesperson);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [report, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "salesperson" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lead close-rate from Pocomos · bounded by date added.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {report ? (
            <span>
              <RefreshedAt asOf={report.computedAt} />
            </span>
          ) : null}
          <Button onClick={refreshNow} disabled={refreshing} size="sm">
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
        </div>
      </div>

      {/* Date-range control */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          From
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          To
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <Button onClick={applyRange} disabled={loading} size="sm" variant="outline">
          {loading ? "Computing…" : "Apply range"}
        </Button>
      </div>

      {note ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {note}
        </div>
      ) : null}

      {!report ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Computing close rate…" : "No data yet — run a refresh."}
        </p>
      ) : (
        <>
          {report.conversionSourceMissing ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              No converted (&ldquo;Customer&rdquo;-status) leads were returned by
              Pocomos&rsquo; <code>/leads/data</code> for this period, so
              conversions read 0. This office&rsquo;s lead feed only exposes Lead
              / Not Interested / Monitor (converted leads leave the leads module —
              likely the <code>mstli.apiuser</code> saved-view scoping). Lead and
              per-rep counts below are still accurate; the conversion source needs
              to be resolved before the close rate is meaningful.
            </div>
          ) : null}

          {/* Team headline */}
          <Card>
            <CardHeader>
              <CardTitle>Team raw close rate</CardTitle>
              <CardDescription>
                Raw close rate — share of leads created in this period that became
                customers. Does not yet exclude unreachable or wrong-number leads.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <div className="text-4xl font-semibold tabular-nums sm:text-5xl">
                  {pct(report.closeRate)}
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">
                    {fmt(report.totalConversions)}
                  </span>{" "}
                  conversions ÷{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {fmt(report.totalLeads)}
                  </span>{" "}
                  leads · {report.periodStart} → {report.periodEnd}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Per-rep table */}
          <Card>
            <CardHeader>
              <CardTitle>By salesperson</CardTitle>
              <CardDescription>
                One row per CSR. Leads with no salesperson or a system/non-CSR
                name are bucketed as Unattributed and kept out of rep
                denominators. Click a column to sort.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <SortableTh label="Salesperson" col="salesperson" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                      <SortableTh label="Leads" col="leads" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                      <SortableTh label="Conversions" col="conversions" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                      <SortableTh label="Close rate" col="closeRate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReps.map((r) => (
                      <RepTr key={r.salesperson} row={r} />
                    ))}
                    {report.unattributedLeads > 0 ? (
                      <tr className="border-b last:border-0 text-muted-foreground">
                        <td className="py-2 pr-4 italic">Unattributed</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(report.unattributedLeads)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(report.unattributedConversions)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {pct(report.unattributedLeads ? (report.unattributedConversions / report.unattributedLeads) * 100 : 0)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2 pr-4">TOTAL</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmt(report.totalLeads)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmt(report.totalConversions)}</td>
                      <td className="py-2 text-right tabular-nums">{pct(report.closeRate)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Attributed: {fmt(report.attributedLeads)} leads across {fmt(report.reps.length)} reps ·
                Unattributed: {fmt(report.unattributedLeads)} leads
                {report.unattributedConversions ? ` (${fmt(report.unattributedConversions)} conversions)` : ""}.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th className={`py-2 font-medium ${align === "right" ? "pl-4 text-right" : "pr-4"}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function RepTr({ row }: { row: RepRow }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-medium">{row.salesperson}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmt(row.leads)}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{fmt(row.conversions)}</td>
      <td className="py-2 text-right tabular-nums">{pct(row.closeRate)}</td>
    </tr>
  );
}
