"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RefreshedAt } from "@/components/refreshed-at";
import { useLiveSales, type SalesMeta } from "@/components/use-live-sales";
import { useSalesTaxonomy } from "@/components/use-sales-taxonomy";
import type { SalesSummary } from "@/lib/sales-data";
import type { ReturnRatePair, SalesTaxonomy } from "@/lib/sales-taxonomy";
import { cn } from "@/lib/utils";
import { CollapsibleSection, MaybeCollapsible } from "@/components/ui/collapsible-section";

const POCOMOS_BASE = "https://mypocomos.net";

/**
 * A list longer than this collapses by default. Short lists stay open — hiding
 * three rows behind a click is worse than just showing them.
 */
const COLLAPSE_OVER_ROWS = 8;

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

// Status palette — meaningful color only (shared with the overdue view):
// neutral = default, healthy = green, attention = amber, action = red.
// Most tiles stay neutral; color is reserved for things that need a human.
const TONE = {
  neutral: "",
  healthy: "text-emerald-600 dark:text-emerald-400",
  attention: "text-amber-600 dark:text-amber-400",
  action: "text-rose-600 dark:text-rose-400",
} as const;
type Tone = keyof typeof TONE;

export function SalesView({
  initial,
  meta,
}: {
  initial: SalesSummary;
  meta: SalesMeta;
}) {
  const { summary, live, refreshing, liveAsOf } = useLiveSales(initial, meta);
  const { taxonomy, loading: taxLoading } = useSalesTaxonomy();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live customer pipeline from Pocomos · year tags.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LiveStatus
            live={live}
            refreshing={refreshing}
            liveAsOf={liveAsOf}
            snapshotDate={meta.snapshotDate}
          />
          <Link
            href="/tv/sales"
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            TV mode
          </Link>
        </div>
      </div>

      <SalesDashboard
        summary={summary}
        taxonomy={taxonomy}
        taxLoading={taxLoading}
      />
    </div>
  );
}

function LiveStatus({
  live,
  refreshing,
  liveAsOf,
  snapshotDate,
}: {
  live: boolean;
  refreshing: boolean;
  liveAsOf: string | null;
  snapshotDate?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-flex h-2 w-2 rounded-full ${
          live ? "animate-pulse bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {live && liveAsOf ? (
        <span>
          live · <RefreshedAt asOf={liveAsOf} />
        </span>
      ) : (
        <span>as of {snapshotDate || "—"}</span>
      )}
      {refreshing ? (
        <span className="italic opacity-70">refreshing live…</span>
      ) : null}
    </span>
  );
}

/**
 * Self-describing stat tile. `def` is the inline criteria text shown in every
 * square. `hint` carries an optional numeric sub-breakdown. `size="hero"` makes
 * the headline KPIs dominate; `tone` applies the shared status palette (used
 * sparingly — most tiles stay neutral). `value` accepts a string so async
 * (taxonomy) tiles can render a "…" placeholder before they load.
 */
function Tile({
  label,
  value,
  def,
  hint,
  size = "default",
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  def?: string;
  hint?: string;
  size?: "default" | "hero";
  tone?: Tone;
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
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
      {def ? (
        <div className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {def}
        </div>
      ) : null}
    </div>
  );
}

function SalesDashboard({
  summary,
  taxonomy,
  taxLoading,
}: {
  summary: SalesSummary;
  taxonomy: SalesTaxonomy | null;
  taxLoading: boolean;
}) {
  const { totals, debug, year } = summary;
  const prevYear = parseInt(year, 10) - 1;

  // All three season tiles come from the TAXONOMY (rev 19), not categorize.ts's
  // tag-only buckets: they're defined by service evidence (was the customer real
  // last season?) which summarize() can't see. summary.buckets / retainedSubtypes
  // remain the tag-only series feeding the snapshots table; NOT displayed.
  const box = taxonomy?.returningBox;
  const sb = taxonomy?.seasonBuckets;
  const returningHint = box
    ? `Auto ${fmt(box.auto)} · SEB ${fmt(box.seb)} · EB ${fmt(box.eb)} · Renewed ${fmt(
        box.renewed
      )} · New Sale ${fmt(box.newSale)}${
        box.churnedReturners ? ` · ${fmt(box.churnedReturners)} sprayed-then-churned` : ""
      }`
    : undefined;

  // Reconciliation: the three season tiles PARTITION the tag-gated Active
  // Customers roster (rev 19 restored this identity). The Returning tile also
  // counts returners who were sprayed this season and have since churned — they
  // aren't in the active roster, so they're called out as a separate term.
  const offBucket = Math.max(0, debug.activeAllStatuses - totals.activeCustomers);

  const taxNum = (n: number | undefined) =>
    taxonomy ? fmt(n ?? 0) : taxLoading ? "…" : "—";

  return (
    <>
      {/*
        Relabels — categorize.ts logic unchanged. NEW→"New", RETURNING→"New –
        Season Skipped". "Returning" is NO LONGER the RETAINED bucket: as of
        rev 17 it is the taxonomy's returningBox (= the return-rate numerator).
        The Not-Renewed / Cancelled / Missing-tags groups below are year-relative
        and also come from /api/sales/taxonomy.
      */}

      {/* Headline KPIs — dominate */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Tile
          size="hero"
          label="Active Customers"
          value={totals.activeCustomers}
          def={`Customers carrying a ${year} year-tag — counted active for this season.`}
        />
        <Tile
          size="hero"
          label="Active Services"
          value={totals.activeServices}
          def="Active contracts held by those current-year customers."
        />
      </div>

      {/* Current-season buckets + reconciliation */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Tile
            label="New"
            value={taxNum(sb?.newCount)}
            def={`Signed up for ${year} with no history at all — no prior-year tag and no prior mosquito service.`}
          />
          <Tile
            label="New – Season Skipped"
            value={taxNum(sb?.seasonSkipped)}
            def={`Signed up for ${year} and has history with us, but wasn't a real ${prevYear} customer — they sat out last season.`}
          />
          <Tile
            label="Returning"
            value={taxNum(box?.total)}
            hint={returningHint}
            def={`Real ${prevYear} customers who came back: they're active with any ${year} tag (signed up — sprays not required), or they've met the ${year} spray rule regardless of current status. Same population as the Return rate card's ${prevYear} → ${year} numerator.`}
          />
        </div>
        {sb ? (
          <p className="text-xs text-muted-foreground">
            {fmt(sb.newCount)} New + {fmt(sb.seasonSkipped)} Season-Skipped +{" "}
            {fmt(sb.returningActive)} Returning = {fmt(sb.activeTagged)} Active
            Customers
            {sb.churnedReturners ? (
              <>
                {" "}
                · Returning shows {fmt(sb.returningTotal)} because{" "}
                {fmt(sb.churnedReturners)} returner
                {sb.churnedReturners === 1 ? " was" : "s were"} sprayed this season
                then churned (counted as returned, no longer active)
              </>
            ) : null}
            {" · "}
            {fmt(offBucket)} more active in Pocomos are off-bucket (no {year} tag —
            see Missing tags)
          </p>
        ) : null}
      </div>

      {/* Year-relative cancelled taxonomy */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <Tile
          label="Not Renewed"
          value={taxNum(taxonomy?.notRenewed)}
          tone="attention"
          hint={
            taxonomy
              ? `${fmt(taxonomy.notRenewedActive)} still marked active · ${fmt(
                  taxonomy.notRenewedInactive
                )} inactive`
              : undefined
          }
          def={`Had a ${prevYear} tag, no ${year} tag — last season's customers who haven't renewed yet.`}
        />
        <Tile
          label="Cancelled – All Time"
          value={taxNum(taxonomy?.cancelledAllTime)}
          hint={
            taxonomy
              ? `${fmt(taxonomy.cancelled.thisYear)} in ${year} · ${fmt(
                  taxonomy.cancelled.lastYear
                )} in ${prevYear} · ${fmt(taxonomy.cancelled.earlier)} earlier${
                  taxonomy.cancelled.unknown
                    ? ` · ${fmt(taxonomy.cancelled.unknown)} undated`
                    : ""
                }`
              : undefined
          }
          def="Marked Inactive in Pocomos in an earlier season (excludes the Not-Renewed group, by last service year)."
        />
      </div>

      <ReturnRateCard taxonomy={taxonomy} loading={taxLoading} />

      <ReturnRateAnomaliesCard taxonomy={taxonomy} loading={taxLoading} />

      <MissingTagsCard taxonomy={taxonomy} loading={taxLoading} year={year} prevYear={prevYear} />

      <ContractTypeCard summary={summary} />
    </>
  );
}

/**
 * Five-season return-rate sparkline (rev 33).
 *
 * FORM: one series, change-over-time → a line. No legend box (the card title
 * names the series) and no number on every point — only the first and last are
 * direct-labeled, plus the endpoint delta, which is the thing ops actually
 * reads off a trend.
 *
 * THE SEAM IS ENCODED, NOT HIDDEN. The three pre-Pocomos points (`sprayOnly`)
 * come from a spray-only rule in RealGreen short-id space; the two live ones
 * also credit an active season tag. Measured gap on the one pair computable
 * both ways (24→25): 76.93% vs 78.8% ≈ 1.9pp. So the historical segment is
 * DASHED with hollow markers — a reader must not mistake a change of method for
 * a change in the business.
 *
 * The y-axis is deliberately NOT zero-based: these are rates in a ~75-85% band
 * and this is a LINE, where a truncated axis is legitimate (a BAR would have to
 * start at zero). The axis range is printed under the plot so the zoom is
 * explicit rather than implied.
 */
function ReturnRateTrend({ pairs }: { pairs: ReturnRatePair[] }) {
  const pts = pairs.filter((p) => p.reliable);
  if (pts.length < 2) return null;

  // Pad the band so the line never rides the frame; keep it honest and labeled.
  const rates = pts.map((p) => p.rate);
  const lo = Math.floor(Math.min(...rates) - 2);
  const hi = Math.ceil(Math.max(...rates) + 2);
  const W = 100;
  const H = 34;
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const y = (r: number) => H - ((r - lo) / (hi - lo)) * H;

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.rate).toFixed(2)}`).join(" ");
  // Split the path so the pre-Pocomos span can be dashed. The joining segment
  // (last historical → first live) is dashed too: it spans the method change.
  const lastHistorical = pts.reduce((acc, p, i) => (p.sprayOnly ? i : acc), -1);
  const solidFrom = Math.max(lastHistorical, 0);
  const dashed = pts
    .slice(0, solidFrom + 1)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.rate).toFixed(2)}`)
    .join(" ");
  const solid = pts
    .slice(solidFrom)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i + solidFrom).toFixed(2)},${y(p.rate).toFixed(2)}`)
    .join(" ");

  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = last.rate - first.rate;

  return (
    <div className="mb-4 rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {first.fromYear} → {last.toYear} trend
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {first.rate.toFixed(1)}% → <strong className="text-foreground">{last.rate.toFixed(1)}%</strong>{" "}
          <span className={delta < 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
            ({delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}pp)
          </span>
        </span>
      </div>
      <svg
        viewBox={`-2 -4 ${W + 4} ${H + 8}`}
        preserveAspectRatio="none"
        className="h-16 w-full text-emerald-600 dark:text-emerald-400"
        role="img"
        aria-label={`Return rate by season: ${pts
          .map((p) => `${p.fromYear} to ${p.toYear} ${p.rate.toFixed(1)} percent`)
          .join(", ")}`}
      >
        {dashed && solidFrom > 0 ? (
          <path d={dashed} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.75} vectorEffect="non-scaling-stroke" />
        ) : null}
        <path d={solid || d} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle
            key={p.fromYear}
            cx={x(i)}
            cy={y(p.rate)}
            r={2.6}
            stroke="currentColor"
            strokeWidth={1.5}
            // Hollow = the pre-Pocomos, spray-only method.
            fill={p.sprayOnly ? "var(--background, #fff)" : "currentColor"}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {p.fromYear} → {p.toYear}: {p.rate.toFixed(1)}% ({fmt(p.returned)}/{fmt(p.realFrom)})
              {p.sprayOnly ? " — spray-only (pre-Pocomos)" : ""}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {pts.map((p) => p.fromYear).join(" · ")} · {last.toYear}
        </span>
        <span>
          axis {lo}–{hi}% · dashed/hollow = pre-Pocomos, spray-only rule (≈1.9pp
          below the current rule where both are measurable)
        </span>
      </div>
    </div>
  );
}

function ReturnRateCard({
  taxonomy,
  loading,
}: {
  taxonomy: SalesTaxonomy | null;
  loading: boolean;
}) {
  const rr = taxonomy?.returnRates;
  const cutoff = rr?.lateSeasonCutoff ?? "Aug 15";
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Return rate
          {rr?.computing ? (
            <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
              (computing — {rr.coveragePct}% covered)
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Of the real mosquito customers of a season, how many came back the next
          season. A <strong>real customer</strong> of a year got{" "}
          <strong>two or more</strong> completed mosquito services that year — or{" "}
          <strong>exactly one, after {cutoff}</strong>, which means they signed up
          too late in the season to have had a second (Event Spray never counts).
          A single early- or mid-season spray is a one-off and doesn&rsquo;t
          count. A customer <strong>returned</strong> the next season if
          they&rsquo;re <strong>active with any tag for that season</strong> —
          signing up counts, sprays not required — <em>or</em> they meet that
          season&rsquo;s spray rule whatever their status now, which credits
          someone who was sprayed and later churned. The current season is in
          progress, so its rate climbs as the season runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rr ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "Couldn’t load return rates."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <ReturnRateTrend pairs={rr.pairs} />
            <table className="w-full text-sm">
              <thead className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:z-10 [&>tr>th]:bg-background">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Season</th>
                  <th className="py-2 pr-4 text-right font-medium">Return rate</th>
                  <th className="py-2 pl-4 text-right font-medium">Returned / Real</th>
                </tr>
              </thead>
              <tbody>
                {rr.pairs.map((p) => (
                  <tr key={p.fromYear} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium tabular-nums">
                      {p.fromYear} → {p.toYear}
                      {p.sprayOnly ? (
                        <span
                          className="ml-1.5 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
                          title="Pre-Pocomos season: computed spray-only in RealGreen short-id space (no season tags existed)."
                        >
                          spray-only
                        </span>
                      ) : null}
                    </td>
                    {p.reliable ? (
                      <>
                        <td className="py-2 pr-4 text-right text-lg font-semibold tabular-nums">
                          {p.rate.toFixed(1)}%
                        </td>
                        <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">
                          {fmt(p.returned)} / {fmt(p.realFrom)}
                          {p.toYear === String(new Date().getFullYear()) ? (
                            <span className="ml-1 text-[11px]">(in&nbsp;progress)</span>
                          ) : null}
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="py-2 pl-4 text-right text-[11px] text-muted-foreground">
                        n/a — needs full service history ({p.fromYear} is outside
                        the scraped window)
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              &ldquo;Real&rdquo; = 2+ completed mosquito-family services that
              calendar year, or exactly one after {cutoff} (a late-season signup);
              Event Spray never counts. &ldquo;Returned&rdquo; = active with any
              tag for the next season, or meeting its spray rule regardless of
              status.{" "}
              {/*
                These two sub-counts are scoped to the LIVE pairs. The frozen
                pre-Pocomos pairs carry lateSignupsTo = 0 and returnedByTag = 0
                by construction (not as a finding), so listing them here would
                assert a zero the history never measured.
              */}
              {rr.pairs.some((p) => p.reliable && !p.sprayOnly && p.lateSignupsFrom + p.lateSignupsTo > 0)
                ? `Late-season signups counted as real — ${rr.pairs
                    .filter((p) => p.reliable && !p.sprayOnly)
                    .map((p) => `${p.fromYear}: ${fmt(p.lateSignupsFrom)}, ${p.toYear}: ${fmt(p.lateSignupsTo)}`)
                    .join("; ")}. `
                : ""}
              {rr.pairs.some((p) => p.reliable && !p.sprayOnly && p.returnedByTag > 0)
                ? `Returns by continuation tag vs. spray history — ${rr.pairs
                    .filter((p) => p.reliable && !p.sprayOnly)
                    .map((p) => `${p.fromYear}→${p.toYear}: ${fmt(p.returnedByTag)} tag, ${fmt(p.returnedBySprayHistory)} sprays`)
                    .join("; ")}. `
                : ""}
              {rr.pairs.some((p) => p.sprayOnly)
                ? `Seasons before 2024 come from the RealGreen "spray dates" exports and are marked spray-only: Pocomos didn't exist yet, so there are no season tags to credit a signup — those pairs count sprays on both sides, computed in RealGreen customer-number space (never through the Pocomos id map, which resolves only customers who still exist today and would drop the churned customers a denominator is made of). Where both rules are measurable (2024→2025) spray-only reads ~1.9pp lower. `
                : ""}
              Completed seasons come from authoritative bulk job exports (2025
              Pocomos completed-jobs, 2024 RealGreen — the system used before
              Pocomos), which count every job on every contract. The in-progress
              season is still read per-customer:{" "}
              {rr.computing
                ? `still computing — ${fmt(rr.covered)} of ${fmt(rr.cohortSize)} histories scraped (${rr.coveragePct}%). Numbers firm up as coverage reaches 100%.`
                : `coverage ${rr.coveragePct}% (${fmt(rr.covered)}/${fmt(rr.cohortSize)}).`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Return-rate anomalies — records we can't measure cleanly. Self-clearing: the
 * roster is recomputed live on every refresh, so fixing a record in Pocomos
 * drops it off. Classes come from the taxonomy (lib/sales-anomalies.ts); empty
 * classes are hidden, so adding a class needs no change here.
 */
function ReturnRateAnomaliesCard({
  taxonomy,
  loading,
}: {
  taxonomy: SalesTaxonomy | null;
  loading: boolean;
}) {
  const an = taxonomy?.anomalies;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Return-rate anomalies
          {an ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {fmt(an.total)} record{an.total === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Records we can&rsquo;t measure cleanly — each one is a customer the
          return rate has to guess about or drop. Fix these in Pocomos and they
          drop off automatically on the next refresh. (Tag hygiene lives in the
          Missing tags card below; this card is measurement faults.)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!an ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "Couldn’t load anomalies."}
          </p>
        ) : an.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to fix — every record is measurable. 🎉
          </p>
        ) : (
          <div className="space-y-6">
            {/* Stat header: count per class */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {an.classes.map((c) => (
                <div key={c.key} className="rounded-md border p-3">
                  <div className="text-2xl font-semibold tabular-nums">{fmt(c.count)}</div>
                  <div className="mt-1 text-xs leading-snug text-muted-foreground">{c.label}</div>
                </div>
              ))}
            </div>

            {/* One collapsible per class — same pattern for every class, collapsed
                by default. Zero-count classes have no rows to show, so they stay
                in the stat header above only. */}
            <div className="space-y-2">
              {an.classes
                .filter((c) => c.count > 0)
                .map((c) => (
                  <CollapsibleSection key={c.key} label={c.label} right={fmt(c.count)}>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {c.description} <strong className="font-medium">Fix:</strong> {c.fix}
                    </p>
                    <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Customer</th>
                          <th className="py-2 pr-4 font-medium">Why it can&rsquo;t be measured</th>
                          <th className="py-2 pl-4 text-right font-medium">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {an.items
                          .filter((i) => i.classKey === c.key)
                          .map((i) => (
                            <tr key={`${i.classKey}-${i.id}`} className="border-b last:border-0 align-top">
                              <td className="py-2 pr-4">
                                <div className="font-medium">{i.name}</div>
                                <div className="text-xs tabular-nums text-muted-foreground">
                                  {i.id}
                                  {i.contact ? ` · ${i.contact}` : ""}
                                </div>
                              </td>
                              <td className="py-2 pr-4 text-xs leading-snug text-muted-foreground">
                                {i.reason}
                              </td>
                              <td className="py-2 pl-4 text-right">
                                {i.profileUrl ? (
                                  <a
                                    href={i.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary underline-offset-4 hover:underline"
                                  >
                                    Profile
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">no record</span>
                                )}
                                {i.related?.map((r) => (
                                  <a
                                    key={r.id}
                                    href={r.profileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 text-primary underline-offset-4 hover:underline"
                                  >
                                    Twin {r.id}
                                  </a>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleSection>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContractTypeCard({ summary }: { summary: SalesSummary }) {
  const { contractTypeGroups, totals } = summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service type</CardTitle>
        <CardDescription>
          Active services ({fmt(totals.activeServices)}) grouped into service
          families.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {contractTypeGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active services.</p>
        ) : (
          <ul className="divide-y text-sm">
            {contractTypeGroups.map((g) => (
              <li key={g.group} className="py-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">{g.group}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {fmt(g.count)}
                  </span>
                </div>
                {g.members.length > 1 ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {g.members
                      .map((m) => `${m.type} ${fmt(m.count)}`)
                      .join(" · ")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Missing tags" — every currently-active customer with NO current-year tag
 * (any prior tags or none). This is the full off-bucket active set; it absorbs
 * the old narrower "Customers with issues" roster (no current AND no prior tag),
 * which is now flagged inline with a "no prior tag" badge. Columns: name, id,
 * all tags, last service date, Profile link (new tab).
 */
function MissingTagsCard({
  taxonomy,
  loading,
  year,
  prevYear,
}: {
  taxonomy: SalesTaxonomy | null;
  loading: boolean;
  year: string;
  prevYear: number;
}) {
  const rows = taxonomy?.missingTags ?? [];
  const noPrior = rows.filter((c) => !c.hadPriorYearTag).length;
  const withPrior = rows.length - noPrior;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Missing tags
          {taxonomy ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {fmt(taxonomy.missingTagsCount)}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Active in Pocomos but carrying no {year} tag — the full off-bucket set
          that still needs a {year} tag applied.{" "}
          {taxonomy ? (
            <span className="tabular-nums">
              {fmt(withPrior)} have a {prevYear} tag (not renewed) ·{" "}
              {fmt(noPrior)} have no prior-year tag at all (
              <span className="text-amber-600 dark:text-amber-400">flagged below</span>
              ).
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!taxonomy ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "Couldn’t load the missing-tags list."}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None — every active customer carries a {year} tag. 🎉
          </p>
        ) : (
          // Short list → show it; long list → collapse it (same pattern as the
          // anomalies card). The stat line in the header stays visible either way.
          <MaybeCollapsible
            collapse={rows.length > COLLAPSE_OVER_ROWS}
            label={`Active customers with no ${year} tag`}
            right={fmt(rows.length)}
          >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Customer</th>
                  <th className="py-2 pr-4 font-medium">ID</th>
                  <th className="py-2 pr-4 font-medium">Tags</th>
                  <th className="py-2 pr-4 font-medium">Last service</th>
                  <th className="py-2 pl-4 text-right font-medium">Pocomos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4 font-medium">
                      {c.name || c.id}
                      {!c.hadPriorYearTag ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                          no prior tag
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                      {c.id}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {c.tags.length ? c.tags.join(" · ") : "(no tags)"}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                      {c.lastServiceDate ?? "—"}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <a
                        href={`${POCOMOS_BASE}/customer/${c.id}/service-information`}
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
          </MaybeCollapsible>
        )}
      </CardContent>
    </Card>
  );
}
