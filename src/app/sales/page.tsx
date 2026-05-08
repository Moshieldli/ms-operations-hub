import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AutoRefresh } from "@/components/auto-refresh";
import { RefreshedAt } from "@/components/refreshed-at";
import { loadSalesSummary, REFRESH_INTERVAL_MS } from "@/lib/sales-data";
import type { SalesSummary } from "@/lib/sheets";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmt(n: number) {
  return n.toLocaleString("en-US");
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

export default async function SalesPage() {
  const result = await loadSalesSummary();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Sales
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Customer pipeline by year-tag bucket.
          </p>
        </div>
        {result.ok ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <RefreshedAt asOf={result.summary.asOf} />
            <Link
              href="/tv/sales"
              className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              TV mode
            </Link>
          </div>
        ) : null}
      </div>

      {!result.ok ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&rsquo;t load sales data</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The Tags sheet must be readable by anyone with the link or
            published to web.
          </CardContent>
        </Card>
      ) : (
        <SalesDashboard summary={result.summary} />
      )}
    </div>
  );
}

function SalesDashboard({ summary }: { summary: SalesSummary }) {
  const { totals, buckets, retainedSubtypes, debug, year } = summary;
  const retainedHint = `Auto ${retainedSubtypes.auto} · SEB ${retainedSubtypes.seb} · EB ${retainedSubtypes.eb}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Stat label="Active Customers" value={fmt(totals.activeCustomers)} />
        <Stat label="Active Services" value={fmt(totals.activeServices)} />
        <Stat
          label="Junk Skipped"
          value={fmt(totals.junkRowsSkipped)}
          hint={`of ${fmt(totals.totalRowsSeen)} rows seen`}
        />
        <Stat
          label="Untagged"
          value={fmt(debug.untagged)}
          hint={
            debug.uncategorized
              ? `${debug.uncategorized} uncategorized`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buckets &middot; {year}</CardTitle>
          <CardDescription>
            Categorization based on year tags in the Tags sheet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-5">
            <BucketCell label="New" value={buckets.NEW} />
            <BucketCell label="Returning" value={buckets.RETURNING} />
            <BucketCell
              label="Retained"
              value={buckets.RETAINED}
              hint={retainedHint}
            />
            <BucketCell label="At Risk" value={buckets.AT_RISK} />
            <BucketCell label="Cancelled" value={buckets.CANCELLED} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
