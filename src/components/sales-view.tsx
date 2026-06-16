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
import type { SalesSummary } from "@/lib/sales-data";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function SalesView({
  initial,
  meta,
}: {
  initial: SalesSummary;
  meta: SalesMeta;
}) {
  const { summary, live, refreshing, liveAsOf } = useLiveSales(initial, meta);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Sales
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
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

      <SalesDashboard summary={summary} />
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
 * Self-describing tile. `def` is the inline criteria/definition text shown in
 * every square (replaces the old separate "How are buckets calculated?" card).
 * `hint` carries an optional numeric sub-breakdown (e.g. RETAINED subtypes).
 */
function BucketCell({
  label,
  value,
  def,
  hint,
}: {
  label: string;
  value: number;
  def?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col rounded-md border p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
        {fmt(value)}
      </div>
      {hint ? (
        <div className="mt-1 text-xs font-medium text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {def ? (
        <div className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {def}
        </div>
      ) : null}
    </div>
  );
}

function SalesDashboard({ summary }: { summary: SalesSummary }) {
  const { totals, buckets, retainedSubtypes, cancelled, debug, year } = summary;
  const retainedHint = `Auto ${retainedSubtypes.auto} · SEB ${retainedSubtypes.seb} · EB ${retainedSubtypes.eb} · Renewed ${retainedSubtypes.renewed}`;
  const onHoldHint = totals.onHoldCustomers
    ? `${fmt(totals.onHoldCustomers)} on hold`
    : undefined;
  const fetchSeconds = (debug.fetchDurationMs / 1000).toFixed(1);
  const tagsHint =
    debug.tagsFailed > 0
      ? `${fmt(debug.tagsFetched)} fetched · ${debug.tagsFailed} failed`
      : `${fmt(debug.tagsFetched)} tags fetched in ${fetchSeconds}s`;
  const yearNum = parseInt(year, 10);
  const prevYear = yearNum - 1;
  const cancelledHint = `${fmt(cancelled.thisYear)} in ${year} · ${fmt(cancelled.lastYear)} in ${prevYear} · ${fmt(cancelled.earlier)} earlier`;

  // Reconciliation: the three current-year-tagged buckets should sum to Active
  // Customers; AT_RISK ("Not Renewed") sits outside that gate. Δ = the edge
  // cases (untagged actives, uncategorized, and AT_RISK members lacking a
  // current-year tag). Computed live so it always ties out to the buckets shown.
  const taggedActive = buckets.NEW + buckets.RETURNING + buckets.RETAINED;
  const notRenewed = buckets.AT_RISK;
  const reconSum = taggedActive + notRenewed;
  const reconDelta = Math.abs(reconSum - totals.activeCustomers);

  return (
    <>
      {/*
        DISPLAY-ONLY relabels — internal bucket keys + categorize.ts logic are
        unchanged; only user-facing labels differ. Map by internal key:
          NEW       → "New"
          RETURNING → "New – Season Skipped"
          RETAINED  → "Returning"
          AT_RISK   → "Not Renewed"      (was "Current Cancelled")
          CANCELLED → "Cancelled – All Time"
        Every tile self-describes via `def` (replaces the old rules card).
      */}

      {/* Row 1 — this season */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-6">
        <BucketCell
          label="Active Customers"
          value={totals.activeCustomers}
          def={`Customers carrying a ${year} year-tag — counted active for this season.`}
        />
        <BucketCell
          label="Active Services"
          value={totals.activeServices}
          def="Active contracts held by those current-year customers."
        />
        <BucketCell
          label="New"
          value={buckets.NEW}
          def="Brand-new this year, no prior-year history."
        />
        <BucketCell
          label="New – Season Skipped"
          value={buckets.RETURNING}
          def="Was a customer before, skipped one or more full seasons, signed up new again this year."
        />
        <BucketCell
          label="Returning"
          value={buckets.RETAINED}
          hint={retainedHint}
          def="Service continued from last year into this year (auto-renew / early rebook / renewed)."
        />
        <BucketCell
          label="Not Renewed"
          value={buckets.AT_RISK}
          def="Treated in a prior year but no current-year tag yet — not renewed for this season."
        />
      </div>

      {/* Reconciliation line */}
      <p className="text-xs text-muted-foreground">
        {fmt(taggedActive)} tagged + {fmt(notRenewed)} not renewed ={" "}
        {fmt(reconSum)} vs {fmt(totals.activeCustomers)} active (Δ
        {fmt(reconDelta)} edge cases)
      </p>

      {/* Row 2 — all-time / untagged */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6">
        <BucketCell
          label="Cancelled – All Time"
          value={totals.cancelledCustomers}
          hint={onHoldHint ? `${cancelledHint} · ${onHoldHint}` : cancelledHint}
          def="Marked Inactive in Pocomos (all years)."
        />
        <BucketCell
          label="Untagged"
          value={debug.untagged}
          hint={
            debug.uncategorized
              ? `${debug.uncategorized} uncategorized`
              : tagsHint
          }
          def="Active in Pocomos but carrying no year tags at all."
        />
      </div>

      <ContractTypeCard summary={summary} />

      <CancelledByYearCard summary={summary} />
    </>
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

function CancelledByYearCard({ summary }: { summary: SalesSummary }) {
  const { cancelled, year } = summary;
  const yearNum = parseInt(year, 10);
  const olderYears = Object.entries(cancelled.byYear)
    .filter(([y]) => {
      const n = parseInt(y, 10);
      return Number.isFinite(n) && n < yearNum - 1;
    })
    .sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancellations by year</CardTitle>
        <CardDescription>
          Derived from each Inactive customer&rsquo;s last service date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <BucketCell label={`${year}`} value={cancelled.thisYear} />
          <BucketCell label={`${yearNum - 1}`} value={cancelled.lastYear} />
          <BucketCell
            label="Earlier"
            value={cancelled.earlier}
            hint={
              olderYears.length
                ? olderYears
                    .slice(0, 4)
                    .map(([y, n]) => `${y}: ${n.toLocaleString("en-US")}`)
                    .join(" · ")
                : undefined
            }
          />
        </div>
        {cancelled.unknown > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {fmt(cancelled.unknown)} cancelled customer
            {cancelled.unknown === 1 ? "" : "s"} have no last-service date and
            are excluded from the year breakdown.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

