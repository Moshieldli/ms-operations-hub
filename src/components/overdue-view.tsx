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

// Row-coloring thresholds (days since last mosquito service). Distinct from the
// 15-day OVERDUE_THRESHOLD_DAYS in mosquito.ts — these only drive the visual
// severity tint, not bucketing.
const LATE_DAYS = 17; // 17–20 days → yellow row
const VERY_LATE_DAYS = 21; // 21+ days → red row

/**
 * Severity tint for an overdue row, by days since last mosquito service:
 *   21+ → red, 17–20 → yellow, <17 (or unknown) → normal.
 *
 * FUTURE — "48h rescue" override (not implemented yet): once we source the
 * assigned-only next-scheduled date (per the scheduled-services probe), a row
 * with an ASSIGNED job within the next 48h should drop back to normal (no tint)
 * even when days_since is high, because service is imminent. Wire that in here:
 *   if (hasAssignedJobWithin48h) return "";   // <-- 48h rescue hook
 */
function rowToneClass(daysSince: number | null): string {
  if (daysSince == null) return "";
  if (daysSince >= VERY_LATE_DAYS) return "bg-rose-50 dark:bg-rose-950/30";
  if (daysSince >= LATE_DAYS) return "bg-amber-50 dark:bg-amber-950/30";
  return "";
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "2026-06-09" → "06/09/26" (matches the Pocomos UI short date). */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

type RowKind = "overdue" | "needsCheck" | "paused";

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

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Overdue" value={fmt(counts.overdue)} accent />
        <Stat label="Paused (balance)" value={fmt(counts.pausedBalance)} amber />
        <Stat label="Current" value={fmt(counts.current)} />
        <Stat label="Excluded (new)" value={fmt(counts.excludedNew)} />
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
            service) are pinned to the top. Accounts with an open balance are not
            here — see the paused section below.
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

      {/* Service paused — open balance */}
      <Card>
        <CardHeader>
          <CardTitle>Service paused — open balance</CardTitle>
          <CardDescription>
            Eligible mosquito accounts carrying an open balance. We intentionally
            pause spray on unpaid accounts, so these are kept out of the overdue
            list. Highest balance first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.pausedBalance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No eligible accounts with an open balance.
            </p>
          ) : (
            <RowTable rows={report.pausedBalance} kind="paused" />
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
  amber,
}: {
  label: string;
  value: string;
  accent?: boolean;
  amber?: boolean;
}) {
  return (
    <div className="rounded-md border p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${
          accent
            ? "text-rose-600 dark:text-rose-400"
            : amber
            ? "text-amber-600 dark:text-amber-400"
            : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RowTable({ rows, kind }: { rows: MosquitoStatusRow[]; kind: RowKind }) {
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
            ) : kind === "paused" ? (
              <th className="py-2 pr-4 text-right font-medium">Balance</th>
            ) : (
              <th className="py-2 pr-4 font-medium">Selected contract</th>
            )}
            <th className="py-2 pr-4 font-medium">Next scheduled</th>
            <th className="py-2 pr-4 font-medium">Sign-up</th>
            <th className="py-2 pl-4 text-right font-medium">Pocomos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.pocomos_id}
              className={`border-b last:border-0 ${rowToneClass(r.days_since)}`}
            >
              <td className="py-2 pr-4 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {r.full_name || r.pocomos_id}
                  {r.is_weekly ? (
                    <span className="rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300">
                      Weekly
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.mosquito_contract_type || "—"}
              </td>
              {kind === "overdue" ? (
                <>
                  <td className="py-2 pr-4 tabular-nums">
                    {r.last_regular_spray ? (
                      shortDate(r.last_regular_spray)
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400">
                        no spray yet
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                    {r.days_since == null ? "—" : fmt(r.days_since)}
                  </td>
                </>
              ) : kind === "paused" ? (
                <td className="py-2 pr-4 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {money(r.open_balance)}
                </td>
              ) : (
                <td className="py-2 pr-4 text-muted-foreground">
                  {r.selected_contract_label || "—"}
                </td>
              )}
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {shortDate(r.next_service_date)}
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {shortDate(r.sign_up_date)}
              </td>
              <td className="py-2 pl-4 text-right">
                {/* needs-check rows link to service HISTORY (to read history &
                    switch the contract); overdue/paused link to the customer
                    PROFILE (service-information). pocomos_id is the 7-digit
                    Pocomos url id. */}
                <a
                  href={`${POCOMOS_BASE}/customer/${r.pocomos_id}/${
                    kind === "needsCheck" ? "service-history" : "service-information"
                  }`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {kind === "needsCheck" ? "History" : "Profile"}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
