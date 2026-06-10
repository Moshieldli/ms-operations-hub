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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums sm:text-3xl">
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

function BucketCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
        {fmt(value)}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function SalesDashboard({ summary }: { summary: SalesSummary }) {
  const { totals, buckets, retainedSubtypes, cancelled, debug, year } = summary;
  const retainedHint = `Auto ${retainedSubtypes.auto} · SEB ${retainedSubtypes.seb} · EB ${retainedSubtypes.eb}`;
  const onHoldHint = totals.onHoldCustomers
    ? `${fmt(totals.onHoldCustomers)} on hold`
    : undefined;
  const fetchSeconds = (debug.fetchDurationMs / 1000).toFixed(1);
  const tagsHint =
    debug.tagsFailed > 0
      ? `${fmt(debug.tagsFetched)} fetched · ${debug.tagsFailed} failed`
      : `${fmt(debug.tagsFetched)} fetched in ${fetchSeconds}s`;
  const yearNum = parseInt(year, 10);
  const prevYear = yearNum - 1;
  const cancelledHint = `${fmt(cancelled.thisYear)} in ${year} · ${fmt(cancelled.lastYear)} in ${prevYear} · ${fmt(cancelled.earlier)} earlier`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Stat label="Active Customers" value={fmt(totals.activeCustomers)} />
        <Stat label="Active Services" value={fmt(totals.activeServices)} />
        <Stat
          label="Cancelled"
          value={fmt(totals.cancelledCustomers)}
          hint={onHoldHint}
        />
        <Stat
          label="Untagged"
          value={fmt(debug.untagged)}
          hint={
            debug.uncategorized
              ? `${debug.uncategorized} uncategorized`
              : tagsHint
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buckets &middot; {year}</CardTitle>
          <CardDescription>
            Live categorization from Pocomos year tags.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            DISPLAY-ONLY relabels — internal bucket keys + categorize.ts logic
            are unchanged; only the user-facing labels differ. The word
            "Returning" intentionally moves from RETAINED's label to RETURNING's
            new "New – Lapsed", so map by key carefully:
              NEW       → "New"
              RETURNING → "New – Lapsed"
              RETAINED  → "Returning"
              AT_RISK   → "Current Cancelled"
              CANCELLED → "Cancelled"
          */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-5">
            <BucketCell label="New" value={buckets.NEW} />
            <BucketCell label="New – Lapsed" value={buckets.RETURNING} />
            <BucketCell
              label="Returning"
              value={buckets.RETAINED}
              hint={retainedHint}
            />
            <BucketCell label="Current Cancelled" value={buckets.AT_RISK} />
            <BucketCell
              label="Cancelled"
              value={buckets.CANCELLED}
              hint={cancelledHint}
            />
          </div>
        </CardContent>
      </Card>

      <ContractTypeCard summary={summary} />

      <CancelledByYearCard summary={summary} />

      <BucketRulesCard />
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

function BucketRulesCard() {
  // DISPLAY-ONLY: labels + criteria text are user-facing. Internal bucket keys
  // and categorize.ts logic are unchanged — each entry below still maps 1:1 to
  // the same internal bucket it always did (NEW, RETURNING, RETAINED, AT_RISK,
  // CANCELLED, in that order).
  const rules: Array<{ label: string; rule: string }> = [
    {
      // internal NEW
      label: "New",
      rule: "Brand-new this year, no prior-year history.",
    },
    {
      // internal RETURNING
      label: "New – Lapsed",
      rule: "Was a customer before, skipped one or more full seasons, signed up new again this year.",
    },
    {
      // internal RETAINED
      label: "Returning",
      rule: "Service continued from last year into this year (auto-renew / early rebook).",
    },
    {
      // internal AT_RISK
      label: "Current Cancelled",
      rule: "Treated last year, NOT treated this year yet.",
    },
    {
      // internal CANCELLED
      label: "Cancelled",
      rule: "Marked Inactive in Pocomos.",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>How are buckets calculated?</CardTitle>
        <CardDescription>
          Buckets read live Pocomos year tags per customer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {rules.map((r) => (
            <div key={r.label} className="rounded-md border p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {r.label}
              </dt>
              <dd className="mt-1 text-sm leading-snug">{r.rule}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
