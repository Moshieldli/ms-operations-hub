"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshedAt } from "@/components/refreshed-at";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { RespraysReport } from "@/lib/service/resprays";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${n.toFixed(2)}%`;

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
                  {tech.weeks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No weeks with applications.</p>
                  ) : (
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
                          {tech.weeks.map((w) => (
                            <tr key={w.weekStart} className="border-b last:border-0">
                              <td className="py-1.5 pr-4 tabular-nums">{w.weekStart}</td>
                              <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(w.applications)}</td>
                              <td
                                className={cn(
                                  "py-1.5 pr-4 text-right tabular-nums",
                                  w.resprays > 0 && "text-red-600 dark:text-red-400"
                                )}
                              >
                                {fmt(w.resprays)}
                              </td>
                              <td className="py-1.5 pl-4 text-right tabular-nums text-muted-foreground">
                                {w.resprays > 0 ? pct(w.rate) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                        A respray is counted in the week of the <em>spray it followed</em>, not the
                        week the re-service happened — so the weekly rate always reads against the
                        sprays that caused it.
                      </p>
                    </div>
                  )}
                </CollapsibleSection>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
