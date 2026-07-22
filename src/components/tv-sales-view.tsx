"use client";

import { RefreshedAt } from "@/components/refreshed-at";
import { useLiveSales, type SalesMeta } from "@/components/use-live-sales";
import { useSalesTaxonomy } from "@/components/use-sales-taxonomy";
import { useSaleBell, SaleBellOverlay, WeekTallyLine } from "@/components/sale-bell";
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
  // New-sale bell (rev 60): rings on the live buckets.NEW series — sound ON
  // here (real Chrome kiosk, not Yodeck). Only after the first LIVE value so a
  // stale snapshot → live jump on load can't ring.
  const bell = useSaleBell(live ? summary.buckets.NEW : null, { sound: true });

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
          <WeekTallyLine bell={bell} />
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

      <TvDashboard summary={summary} taxonomy={taxonomy} newFlash={bell.splash != null} />
      <SaleBellOverlay bell={bell} />
    </div>
  );
}

function TvDashboard({
  summary,
  taxonomy,
  newFlash,
}: {
  summary: SalesSummary;
  taxonomy: SalesTaxonomy | null;
  newFlash?: boolean;
}) {
  const { totals, contractTypeGroups } = summary;
  // All three season tiles come from the taxonomy (rev 19), not categorize.ts —
  // they're defined by service evidence. See sales-view.tsx / SeasonBuckets.
  const box = taxonomy?.returningBox;
  const sb = taxonomy?.seasonBuckets;

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
          <BigBucket label="New" value={sb ? sb.newCount : "…"} flash={newFlash} />
          <BigBucket label="New – Season Skipped" value={sb ? sb.seasonSkipped : "…"} />
          <BigBucket
            label="Returning"
            value={box ? box.total : "…"}
            hint={
              box
                ? `Auto ${fmt(box.auto)} · SEB ${fmt(box.seb)} · EB ${fmt(box.eb)} · Renewed ${fmt(
                    box.renewed
                  )} · New Sale ${fmt(box.newSale)}`
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
            {/*
              The two LIVE pairs only. Rev 33 added three frozen pre-Pocomos
              pairs for the /sales trend; showing all five here would reflow this
              2-up grid into three cramped rows on a screen read from across a
              room. The 5-season arc goes in the one-line caption below instead.
            */}
            {taxonomy.returnRates.pairs.filter((p) => p.reliable && !p.sprayOnly).map((p) => (
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
          {taxonomy.returnRates.pairs.filter((p) => p.reliable).length > 2 ? (
            <div className="mt-3 text-xs tabular-nums text-muted-foreground lg:text-sm">
              {taxonomy.returnRates.pairs
                .filter((p) => p.reliable)
                .map((p) => `${p.toYear.slice(2)} ${p.rate.toFixed(0)}%`)
                .join("  ·  ")}
            </div>
          ) : null}
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
  flash,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: keyof typeof TV_TONE;
  /** New-sale celebration flash (rev 60) — emerald pulse while the splash runs. */
  flash?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border p-5 lg:p-7 ${
        flash
          ? "animate-pulse border-emerald-500 bg-emerald-50 motion-reduce:animate-none dark:bg-emerald-950/30"
          : ""
      }`}
    >
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
