"use client";

import { Fragment, useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { ResprayDetail, RespraysReport, TechRow } from "@/lib/service/resprays";
import { cn } from "@/lib/utils";

const POCOMOS_BASE = "https://mypocomos.net";
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${n.toFixed(2)}%`;
const profileUrl = (id: string) => `${POCOMOS_BASE}/customer/${id}/service-information`;

export function RespraysView({
  initial,
  rules,
}: {
  initial: RespraysReport;
  rules: {
    flagMultiple: number;
    flagMinApplications: number;
    weeklyCalloutMinApps: number;
  };
}) {
  const [report, setReport] = useState<RespraysReport>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await fetch("/api/service/resprays", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "refresh failed");
      if (json.skipped) setNote("A refresh is already running — try again in a moment.");
      const fresh = await (await fetch("/api/service/resprays", { cache: "no-store" })).json();
      if (fresh.ok) setReport(fresh.report);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const t = report.totals;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Tech respray performance</CardTitle>
              {/* The attribution rule, on the label so it's never lost. */}
              <CardDescription>
                Respray = <strong>any re-service this year</strong>, attributed
                to the most recent prior tech on that customer —{" "}
                <strong>including prior re-services</strong> (so a re-service of a
                re-service blames the last person who touched the account). {report.year}{" "}
                only; prior-year jobs are never used, and a re-service with no
                prior {report.year} job is unattributed. Rate = a tech&rsquo;s
                attributed resprays ÷ his mosquito applications (Initial +
                Regular) YTD.{" "}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label={`Re-service jobs ${report.year}`}
              value={fmt(t.reserviceJobs)}
              def="Every completed mosquito re-service this year."
            />
            <Stat
              label="Attributed resprays"
              value={fmt(t.countedResprays)}
              def={`Blamed on the most recent prior tech. ${fmt(t.chainResprays)} were chains (prior job was itself a re-service).`}
              tone="bad"
            />
            <Stat
              label="Unattributed"
              value={fmt(t.unattributed)}
              def={`Re-services with no prior ${report.year} mosquito job — nobody blamed.`}
            />
            <Stat
              label="Team avg rate"
              value={pct(t.teamRate)}
              def={`${fmt(t.countedResprays)} resprays ÷ ${fmt(t.applications)} applications YTD.`}
            />
          </div>
        </CardContent>
      </Card>

      <CadenceHealthCard report={report} />

      <WeeklyLeaderboardCard report={report} minApps={rules.weeklyCalloutMinApps} />

      <RepeatCustomersCard report={report} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By technician</CardTitle>
          <CardDescription>
            Flagged at <strong>{rules.flagMultiple}×</strong> the team average or
            worse, and only with <strong>{rules.flagMinApplications}+</strong>{" "}
            applications — below that the rate is too noisy to read. Click a tech
            for the weekly breakdown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.techs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No mosquito applications yet this year.
            </p>
          ) : (
            <div className="space-y-2">
              {report.techs.map((tech) => (
                <CollapsibleSection
                  key={tech.technician}
                  label={
                    <span className="flex items-center gap-2">
                      <span>{tech.technician}</span>
                      {tech.flagged ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-950 dark:text-red-400">
                          {tech.vsTeam.toFixed(1)}× team avg
                        </span>
                      ) : null}
                    </span>
                  }
                  right={
                    <span className="flex items-center gap-4 tabular-nums">
                      <span title="Mosquito applications YTD (Initial + Regular)">
                        {fmt(tech.applications)} apps
                      </span>
                      <span title="Attributed resprays">{fmt(tech.resprays)} resprays</span>
                      <span
                        className={cn(
                          "w-16 text-right font-medium",
                          tech.flagged && "text-red-600 dark:text-red-400"
                        )}
                      >
                        {pct(tech.rate)}
                      </span>
                      <VsBadge vsTeam={tech.vsTeam} flagged={tech.flagged} />
                    </span>
                  }
                >
                  <TechBody tech={tech} />

                </CollapsibleSection>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A tech's expanded body: an "All resprays" section (full YTD list) above the
 * weekly table, whose Resprays cell expands per-week to the same detail rows.
 * Client state (which weeks are open) lives here so each tech is independent.
 */
function TechBody({ tech }: { tech: TechRow }) {
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const toggle = (w: string) =>
    setOpenWeeks((s) => {
      const n = new Set(s);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });

  if (tech.weeks.length === 0) {
    return <p className="text-xs text-muted-foreground">No weeks with applications.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Full YTD list — so you don't have to hunt week by week. */}
      {tech.allResprays.length > 0 ? (
        <CollapsibleSection
          label="All resprays (YTD)"
          right={`${fmt(tech.allResprays.length)} attributed`}
        >
          <ResprayDetailTable details={tech.allResprays} />
        </CollapsibleSection>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Week of</th>
              <th className="py-2 pr-4 text-right font-medium">Sprays</th>
              <th className="py-2 pr-4 text-right font-medium">Resprays</th>
              <th className="py-2 pl-4 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {tech.weeks.map((w) => {
              const open = openWeeks.has(w.weekStart);
              const hasResprays = w.resprays > 0;
              return (
                <Fragment key={w.weekStart}>
                  <tr className={cn("border-b", open && "border-b-0")}>
                    <td className="py-1.5 pr-4 tabular-nums">{w.weekStart}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(w.applications)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {hasResprays ? (
                        <button
                          type="button"
                          onClick={() => toggle(w.weekStart)}
                          aria-expanded={open}
                          className="inline-flex items-center gap-1 font-medium text-red-600 underline-offset-4 hover:underline dark:text-red-400"
                          title="Show the resprays counted this week"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            className={cn(
                              "h-3.5 w-3.5 transition-transform duration-150",
                              open && "rotate-90"
                            )}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                          {fmt(w.resprays)}
                        </button>
                      ) : (
                        <span className="tabular-nums">0</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-4 text-right tabular-nums text-muted-foreground">
                      {hasResprays ? pct(w.rate) : "—"}
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b">
                      <td colSpan={4} className="bg-muted/30 px-3 py-2">
                        <ResprayDetailTable details={w.resprayDetails} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          A respray is counted in the week of the <em>spray it followed</em>, not the week the
          re-service happened — so the weekly rate always reads against the sprays that caused it.
        </p>
      </div>
    </div>
  );
}

/**
 * Audit rows for a set of resprays: customer, the blamed prior job + its type,
 * the re-service, days between, a CHAIN badge when the blamed job was itself a
 * re-service, and a Pocomos profile link.
 */
function ResprayDetailTable({ details }: { details: ResprayDetail[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">Customer</th>
            <th className="py-1.5 pr-4 font-medium">Prior job</th>
            <th className="py-1.5 pr-4 font-medium">Re-service</th>
            <th className="py-1.5 pr-4 text-right font-medium">Days between</th>
            <th className="py-1.5 pl-4 text-right font-medium">Profile</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d) => (
            <tr key={d.invoiceNo} className="border-b last:border-0">
              <td className="py-1.5 pr-4">
                <span className="inline-flex items-center gap-1.5">
                  {d.customerName}
                  {d.chain ? (
                    <span
                      title="The blamed prior job was itself a re-service — a repeat/chain respray."
                      className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                    >
                      chain
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">
                {d.priorJobDate}
                <span className="ml-1 text-[10px] uppercase tracking-wide">{d.priorJobType}</span>
              </td>
              <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">{d.reserviceDate}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums font-medium">{fmt(d.gapDays)}</td>
              <td className="py-1.5 pl-4 text-right">
                <a
                  href={profileUrl(d.customerId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Audit
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Weekly leaderboard — current + last full week, callouts, and fun auto-stats. */
/**
 * Cadence health (rev 37) — the share of consecutive-service gaps that ran past
 * the 11-17 day window, this season vs the two completed ones.
 *
 * Tone is INVERTED from the rest of the page: here a HIGHER number is worse, so
 * the current season is tinted amber when it sits above the oldest complete
 * season. The comparison is the point — a single "31%" means nothing without
 * "it was 9% two seasons ago".
 *
 * Strictly >17 days: 17 is the top of the target window and counts as on-time.
 */
function CadenceHealthCard({ report }: { report: RespraysReport }) {
  const rows = report.cadence ?? [];
  if (rows.length === 0) return null;
  const live = rows.find((r) => r.live);
  const baseline = rows.find((r) => !r.live);
  const worse = live && baseline ? live.pct > baseline.pct : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Cadence health — share of gaps beyond our 11&ndash;17 day window
        </CardTitle>
        <CardDescription>
          Of every gap between a customer&rsquo;s consecutive mosquito services,
          how many ran <strong>longer than {17} days</strong>. A 17-day gap is on
          target and doesn&rsquo;t count. Longer gaps are when mosquitoes come
          back, so this is a leading indicator for resprays and retention — the
          current season is live and moves as the season runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {rows.map((r) => (
            <div
              key={r.year}
              className={cn(
                "rounded-lg border p-4",
                r.live && worse && "border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {r.year}
                  {r.live ? " · live" : ""}
                </span>
                {r.live && baseline ? (
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      worse ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {r.pct >= baseline.pct ? "+" : ""}
                    {(r.pct - baseline.pct).toFixed(1)}pp vs {baseline.year}
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  "mt-1 text-3xl font-semibold tabular-nums",
                  r.live && worse && "text-amber-700 dark:text-amber-400"
                )}
              >
                {r.pct.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {fmt(r.beyond)} of {fmt(r.gaps)} gaps
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          Gaps are measured per customer within a season, so no cross-year id
          matching is involved. 2024 comes from the RealGreen export, 2025 from
          the Pocomos completed-jobs export, and the current season from the same
          live cache this page already uses. Note this counts gaps{" "}
          <strong>strictly over 17 days</strong>; an earlier ad-hoc figure that
          included exactly-17-day gaps read higher (12.3% / 35.4% / 38.7%).
        </p>
      </CardContent>
    </Card>
  );
}

function WeeklyLeaderboardCard({ report, minApps }: { report: RespraysReport; minApps: number }) {
  const { current, lastFull, funStats } = report.weekly;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">This week on the board 🏆</CardTitle>
        <CardDescription>
          Current week and last full week. Callouts need {minApps}+ sprays that
          week so a light week can&rsquo;t win or lose it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {funStats.length ? (
          <div className="flex flex-wrap gap-2">
            {funStats.map((s, i) => (
              <span
                key={i}
                className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <WeekPanel recap={current} />
          <WeekPanel recap={lastFull} />
        </div>
      </CardContent>
    </Card>
  );
}

function WeekPanel({ recap }: { recap: import("@/lib/service/resprays").WeeklyRecap }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">
          {recap.label}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            (wk of {recap.weekStart})
          </span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {fmt(recap.totalResprays)} / {fmt(recap.totalApps)} · {pct(recap.teamRate)}
        </div>
      </div>
      {recap.techs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sprays recorded yet this week.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
            {recap.bestRate ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Best: {recap.bestRate.technician} ({pct(recap.bestRate.rate)}, {fmt(recap.bestRate.resprays)}/{fmt(recap.bestRate.applications)})
              </span>
            ) : null}
            {recap.needsAttention ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Watch: {recap.needsAttention.technician} ({pct(recap.needsAttention.rate)})
              </span>
            ) : null}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Tech</th>
                <th className="py-1 pr-3 text-right font-medium">Sprays</th>
                <th className="py-1 pr-3 text-right font-medium">Resprays</th>
                <th className="py-1 pl-3 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {recap.techs.map((s) => (
                <tr key={s.technician} className="border-b last:border-0">
                  <td className="py-1 pr-3">{s.technician}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(s.applications)}</td>
                  <td
                    className={cn(
                      "py-1 pr-3 text-right tabular-nums",
                      s.resprays > 0 && "text-red-600 dark:text-red-400"
                    )}
                  >
                    {fmt(s.resprays)}
                  </td>
                  <td className="py-1 pl-3 text-right tabular-nums text-muted-foreground">
                    {s.resprays > 0 ? pct(s.rate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Customers with 2+ resprays this year — repeat-respray watch list. */
function RepeatCustomersCard({ report }: { report: RespraysReport }) {
  const rows = report.repeatCustomers;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repeat respray customers</CardTitle>
        <CardDescription>
          Accounts with <strong>2+ resprays</strong> this year — worth a look for
          a product, access, or account issue rather than a tech one. &ldquo;Chain&rdquo;
          counts resprays whose prior job was itself a re-service.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No customer has been re-serviced twice this year.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Customer</th>
                  <th className="py-2 pr-4 text-right font-medium">Resprays</th>
                  <th className="py-2 pr-4 text-right font-medium">Chain</th>
                  <th className="py-2 pl-4 text-right font-medium">Profile</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.customerId} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{c.customerName}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">
                      {fmt(c.resprays)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                      {c.chainResprays > 0 ? fmt(c.chainResprays) : "—"}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <a
                        href={profileUrl(c.customerId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Profile
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VsBadge({ vsTeam, flagged }: { vsTeam: number; flagged: boolean }) {
  const label = vsTeam === 0 ? "—" : `${vsTeam.toFixed(2)}×`;
  return (
    <span
      title="Rate vs the team average"
      className={cn(
        "w-14 rounded px-1.5 py-0.5 text-right text-[11px] font-medium tabular-nums",
        flagged
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
          : vsTeam > 1
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
      )}
    >
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  def,
  tone,
}: {
  label: string;
  value: string;
  def?: string;
  tone?: "bad";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-red-600 dark:text-red-400"
        )}
      >
        {value}
      </div>
      {def ? <div className="mt-2 text-[11px] leading-snug text-muted-foreground">{def}</div> : null}
    </div>
  );
}
