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
import type { SalesTaxonomy } from "@/lib/sales-taxonomy";
import { cn } from "@/lib/utils";

const POCOMOS_BASE = "https://mypocomos.net";

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
  const { totals, buckets, debug, year } = summary;
  const prevYear = parseInt(year, 10) - 1;

  // "Returning" now comes from the TAXONOMY (rev 17), not summary.buckets.RETAINED:
  // it is the return-rate numerator set — prior-year real customers who returned
  // (see ReturningBox). summary.retainedSubtypes / buckets.RETAINED remain the
  // tag-only series and still feed the snapshots table; they are NOT displayed.
  const box = taxonomy?.returningBox;
  const returningHint = box
    ? `Auto ${fmt(box.auto)} · SEB ${fmt(box.seb)} · EB ${fmt(box.eb)} · Renewed ${fmt(
        box.renewed
      )} · by spray history ${fmt(box.bySprayHistory)}`
    : undefined;

  // Reconciliation (synchronous, from summary): Active Customers is the tag-gated
  // count; the remaining active-status customers are off-bucket (the
  // Not-Renewed-active + Issues that the taxonomy details). NOTE: this no longer
  // equals NEW + RETURNING + Returning — the Returning tile is now a
  // service-evidence population, not the tag-based RETAINED bucket.
  const taggedActive = totals.activeCustomers;
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
            value={buckets.NEW}
            def="Brand-new this year, no prior-year history."
          />
          <Tile
            label="New – Season Skipped"
            value={buckets.RETURNING}
            def="Was a customer before, skipped one or more full seasons, signed up new again this year."
          />
          <Tile
            label="Returning"
            value={taxNum(box?.total)}
            hint={returningHint}
            def={`Real ${prevYear} customers who came back: they've had a real ${year} season (2+ mosquito services, or one late signup) or their service rolled over on a ${year} auto-renew / early-rebook / renewed tag. Same population as the Return rate card's ${prevYear} → ${year} numerator.`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {fmt(taggedActive)} tagged active + {fmt(offBucket)} off-bucket
          (not-renewed / issues) = {fmt(debug.activeAllStatuses)} active customers
        </p>
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

      <MissingTagsCard taxonomy={taxonomy} loading={taxLoading} year={year} prevYear={prevYear} />

      <ContractTypeCard summary={summary} />
    </>
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
          count. A customer <strong>returned</strong> if they&rsquo;re a real
          customer of the next season <em>or</em> they&rsquo;re still active with
          that season&rsquo;s auto-renew / early-rebook / renewed tag (service
          rolled over, spray not due yet). The current season is in progress, so
          its rate climbs as the season runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rr ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "Couldn’t load return rates."}
          </p>
        ) : (
          <div className="overflow-x-auto">
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
              Event Spray never counts. &ldquo;Returned&rdquo; = real the next
              season, or still active on that season&rsquo;s continuation tag.{" "}
              {rr.pairs.some((p) => p.reliable && p.lateSignupsFrom + p.lateSignupsTo > 0)
                ? `Late-season signups counted as real — ${rr.pairs
                    .filter((p) => p.reliable)
                    .map((p) => `${p.fromYear}: ${fmt(p.lateSignupsFrom)}, ${p.toYear}: ${fmt(p.lateSignupsTo)}`)
                    .join("; ")}. `
                : ""}
              {rr.pairs.some((p) => p.reliable && p.returnedByTag > 0)
                ? `Returns by continuation tag vs. spray history — ${rr.pairs
                    .filter((p) => p.reliable)
                    .map((p) => `${p.fromYear}→${p.toYear}: ${fmt(p.returnedByTag)} tag, ${fmt(p.returnedBySprayHistory)} sprays`)
                    .join("; ")}. `
                : ""}
              {rr.computing
                ? `Still computing: ${fmt(rr.covered)} of ${fmt(rr.cohortSize)} customers' histories scraped (${rr.coveragePct}%). Numbers firm up as coverage reaches 100%.`
                : `Coverage ${rr.coveragePct}% (${fmt(rr.covered)}/${fmt(rr.cohortSize)}).`}{" "}
              The service-history page only renders the most recent ~season of
              services, so the current→prior pair is exact but earlier pairs
              (2024→25) need a full-history source before they&rsquo;re valid.
            </p>
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
        )}
      </CardContent>
    </Card>
  );
}
