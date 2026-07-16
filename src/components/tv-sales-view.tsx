"use client";

import { RefreshedAt } from "@/components/refreshed-at";
import { useLiveSales, type SalesMeta } from "@/components/use-live-sales";
import { useSalesTaxonomy } from "@/components/use-sales-taxonomy";
import type { SalesSummary } from "@/lib/sales-data";
import type { SalesTaxonomy } from "@/lib/sales-taxonomy";

const fmt = (n: number) => n.toLocaleString("en-US");

export function TvSalesView({
  initial,
  meta,
}: {
  initial: SalesSummary;
  meta: SalesMeta;
}) {
  const { summary, live, refreshing, liveAsOf } = useLiveSales(initial, meta);
  const { taxonomy } = useSalesTaxonomy();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background p-6 lg:p-10">
      <header className="flex items-baseline justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            MS Operations Hub
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight lg:text-5xl">
            Sales
            <span className="text-muted-foreground"> · {summary.year}</span>
          </h1>
        </div>
        <div className="flex items-center gap-3 text-base text-muted-foreground lg:text-lg">
          <span
            className={`inline-flex h-3 w-3 rounded-full ${
              live ? "animate-pulse bg-emerald-500" : "bg-amber-500"
            }`}
          />
          {live && liveAsOf ? (
            <span>
              live · <RefreshedAt asOf={liveAsOf} />
            </span>
          ) : (
            <span>as of {meta.snapshotDate || "—"}</span>
          )}
          {refreshing ? (
            <span className="text-sm italic opacity-70">refreshing live…</span>
          ) : null}
        </div>
      </header>

      <TvDashboard summary={summary} taxonomy={taxonomy} />
    </div>
  );
}

function TvDashboard({
  summary,
  taxonomy,
}: {
  summary: SalesSummary;
  taxonomy: SalesTaxonomy | null;
}) {
  const { totals, buckets, contractTypeGroups } = summary;
  // "Returning" = the taxonomy's returningBox (= the return-rate numerator), not
  // summary.buckets.RETAINED — see sales-view.tsx / ReturningBox (rev 17).
  const box = taxonomy?.returningBox;

  return (
    <div className="mt-8 flex flex-1 flex-col gap-8 lg:mt-12 lg:gap-12">
      <section className="grid grid-cols-2 gap-6 lg:gap-10">
        <BigStat label="Active Customers" value={fmt(totals.activeCustomers)} />
        <BigStat label="Active Services" value={fmt(totals.activeServices)} />
      </section>

      <section className="flex flex-1 flex-col">
        <div className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground lg:text-base">
          Buckets
        </div>
        {/*
          Relabels (match /sales). categorize.ts logic unchanged:
            NEW→"New", RETURNING→"New – Season Skipped",
            AT_RISK→"Not Renewed", CANCELLED→"Cancelled – All Time".
          "Returning" is the taxonomy returningBox (rev 17), NOT RETAINED.
          Numbers are high-contrast neutral for glanceability; color is reserved
          for the one bucket that needs attention (Not Renewed → amber).
        */}
        <div className="grid flex-1 grid-cols-2 gap-4 lg:grid-cols-5 lg:gap-6">
          <BigBucket label="New" value={buckets.NEW} />
          <BigBucket label="New – Season Skipped" value={buckets.RETURNING} />
          <BigBucket
            label="Returning"
            value={box ? box.total : "…"}
            hint={
              box
                ? `Auto ${fmt(box.auto)} · SEB ${fmt(box.seb)} · EB ${fmt(box.eb)} · Renewed ${fmt(
                    box.renewed
                  )} · by spray history ${fmt(box.bySprayHistory)}`
                : undefined
            }
          />
          <BigBucket
            label="Not Renewed"
            value={taxonomy ? taxonomy.notRenewed : "…"}
            tone="attention"
          />
          <BigBucket
            label="Cancelled – All Time"
            value={taxonomy ? taxonomy.cancelledAllTime : "…"}
          />
        </div>
      </section>

      {taxonomy?.returnRates && taxonomy.returnRates.pairs.length > 0 ? (
        <section className="flex flex-col">
          <div className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground lg:text-base">
            Mosquito return rate
            {taxonomy.returnRates.computing ? (
              <span className="ml-2 text-xs normal-case tracking-normal text-amber-500">
                computing · {taxonomy.returnRates.coveragePct}%
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-4 lg:gap-6">
            {taxonomy.returnRates.pairs.filter((p) => p.reliable).map((p) => (
              <div
                key={p.fromYear}
                className="flex flex-col rounded-xl border p-5 lg:p-7"
              >
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground lg:text-sm">
                  {p.fromYear} → {p.toYear}
                </div>
                <div className="mt-2 text-4xl font-semibold tabular-nums lg:text-6xl">
                  {p.rate.toFixed(0)}%
                </div>
                <div className="mt-2 text-xs text-muted-foreground lg:text-sm tabular-nums">
                  {fmt(p.returned)} / {fmt(p.realFrom)} served
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {contractTypeGroups.length > 0 ? (
        <section className="flex flex-col">
          <div className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground lg:text-base">
            Service type
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 lg:grid-cols-3 lg:text-xl">
            {contractTypeGroups.map((g) => (
              <div
                key={g.group}
                className="flex items-baseline justify-between gap-4 border-b py-1"
              >
                <span className="truncate text-muted-foreground">{g.group}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {fmt(g.count)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-6 lg:p-8">
      <div className="text-sm uppercase tracking-[0.2em] text-muted-foreground lg:text-base">
        {label}
      </div>
      <div className="mt-2 text-5xl font-semibold tabular-nums lg:text-7xl">
        {value}
      </div>
    </div>
  );
}

// TV uses meaningful color only: neutral (high-contrast foreground) for most,
// amber for the one bucket that needs attention. No decorative per-bucket hues.
const TV_TONE = {
  neutral: "text-foreground",
  attention: "text-amber-600 dark:text-amber-400",
} as const;

function BigBucket({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: keyof typeof TV_TONE;
}) {
  return (
    <div className="flex flex-col rounded-xl border p-5 lg:p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground lg:text-sm">
        {label}
      </div>
      <div
        className={`mt-2 flex-1 text-4xl font-semibold tabular-nums lg:text-6xl ${TV_TONE[tone]}`}
      >
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {hint ? (
        <div className="mt-2 text-xs text-muted-foreground lg:text-sm">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
