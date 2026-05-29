import { AutoRefresh } from "@/components/auto-refresh";
import { RefreshedAt } from "@/components/refreshed-at";
import {
  loadSalesSummary,
  REFRESH_INTERVAL_MS,
  type SalesSummary,
} from "@/lib/sales-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fmt = (n: number) => n.toLocaleString("en-US");

export default async function TvSalesPage() {
  const result = await loadSalesSummary();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background p-6 lg:p-10">
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />

      <header className="flex items-baseline justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            MS Operations Hub
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight lg:text-5xl">
            Sales{result.ok ? <span className="text-muted-foreground"> · {result.summary.year}</span> : null}
          </h1>
        </div>
        {result.ok ? (
          <div className="flex items-center gap-3 text-base text-muted-foreground lg:text-lg">
            <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-emerald-500" />
            <RefreshedAt asOf={result.summary.asOf} />
          </div>
        ) : null}
      </header>

      {!result.ok ? (
        <div className="mt-12 rounded-lg border p-8">
          <div className="text-2xl font-semibold">Couldn&rsquo;t load sales data</div>
          <div className="mt-2 text-muted-foreground">{result.error}</div>
        </div>
      ) : (
        <TvDashboard summary={result.summary} />
      )}
    </div>
  );
}

function TvDashboard({ summary }: { summary: SalesSummary }) {
  const { totals, buckets, retainedSubtypes, serviceTypeBreakdown } = summary;

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
        <div className="grid flex-1 grid-cols-2 gap-4 lg:grid-cols-5 lg:gap-6">
          <BigBucket label="New" value={buckets.NEW} accent="emerald" />
          <BigBucket label="Returning" value={buckets.RETURNING} accent="sky" />
          <BigBucket
            label="Retained"
            value={buckets.RETAINED}
            accent="violet"
            hint={`Auto ${retainedSubtypes.auto} · SEB ${retainedSubtypes.seb} · EB ${retainedSubtypes.eb}`}
          />
          <BigBucket label="At Risk" value={buckets.AT_RISK} accent="amber" />
          <BigBucket
            label="Cancelled"
            value={buckets.CANCELLED}
            accent="rose"
          />
        </div>
      </section>

      {serviceTypeBreakdown.length > 0 ? (
        <section className="flex flex-col">
          <div className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground lg:text-base">
            Services by type
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 lg:grid-cols-3 lg:text-xl">
            {serviceTypeBreakdown.map((row) => (
              <div
                key={row.type}
                className="flex items-baseline justify-between gap-4 border-b py-1"
              >
                <span className="truncate text-muted-foreground">
                  {row.type}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {fmt(row.count)}
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

const ACCENT: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
};

function BigBucket({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent: keyof typeof ACCENT;
}) {
  return (
    <div className="flex flex-col rounded-xl border p-5 lg:p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground lg:text-sm">
        {label}
      </div>
      <div
        className={`mt-2 flex-1 text-4xl font-semibold tabular-nums lg:text-6xl ${ACCENT[accent]}`}
      >
        {fmt(value)}
      </div>
      {hint ? (
        <div className="mt-2 text-xs text-muted-foreground lg:text-sm">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
