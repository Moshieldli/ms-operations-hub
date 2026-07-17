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
    maxGapDays: number;
    cadenceMin: number;
    cadenceMax: number;
    flagMultiple: number;
    flagMinApplications: number;
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
                Respray = re-service within {rules.maxGapDays} days of the prior
                spray; our normal cadence is {rules.cadenceMin}&ndash;
                {rules.cadenceMax} days; older gaps aren&rsquo;t counted. {report.year}{" "}
                only — prior-year sprays are never used. A counted respray is
                blamed on the tech who did <em>that prior spray</em>; rate = his
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
              def="Every completed mosquito re-service this year, before the window rule."
            />
            <Stat
              label={`Counted resprays (≤${rules.maxGapDays}d)`}
              value={fmt(t.countedResprays)}
              def="Landed inside the window → attributed to the prior spray's tech."
              tone="bad"
            />
            <Stat
              label={`Excluded (${rules.cadenceMin}+d / unattributed)`}
              value={fmt(t.excludedGap + t.unattributed)}
              def={`${fmt(t.excludedGap)} were ${rules.cadenceMin}+ days later (normal cadence) · ${fmt(
                t.unattributed
              )} had no prior ${report.year} spray.`}
            />
            <Stat
              label="Team avg rate"
              value={pct(t.teamRate)}
              def={`${fmt(t.countedResprays)} resprays ÷ ${fmt(t.applications)} applications YTD.`}
            />
          </div>
        </CardContent>
      </Card>

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

/** Audit rows for a set of resprays: customer, both dates, gap, profile link. */
function ResprayDetailTable({ details }: { details: ResprayDetail[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">Customer</th>
            <th className="py-1.5 pr-4 font-medium">Prior spray</th>
            <th className="py-1.5 pr-4 font-medium">Re-service</th>
            <th className="py-1.5 pr-4 text-right font-medium">Days between</th>
            <th className="py-1.5 pl-4 text-right font-medium">Profile</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d) => (
            <tr key={d.invoiceNo} className="border-b last:border-0">
              <td className="py-1.5 pr-4">{d.customerName}</td>
              <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">{d.priorSprayDate}</td>
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
