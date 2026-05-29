import { TvSalesView } from "@/components/tv-sales-view";
import { loadInitialSales } from "@/lib/sales-data";

export const dynamic = "force-dynamic";
// Snapshot-first: the common path is a fast DB read. maxDuration stays high to
// cover the fallback live build when no snapshot exists yet.
export const maxDuration = 300;

export default async function TvSalesPage() {
  const initial = await loadInitialSales();

  if (!initial.ok) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-background p-6 lg:p-10">
        <header className="flex items-baseline justify-between gap-6">
          <h1 className="text-3xl font-semibold tracking-tight lg:text-5xl">
            Sales
          </h1>
        </header>
        <div className="mt-12 rounded-lg border p-8">
          <div className="text-2xl font-semibold">
            Couldn&rsquo;t load sales data
          </div>
          <div className="mt-2 text-muted-foreground">{initial.error}</div>
        </div>
      </div>
    );
  }

  return (
    <TvSalesView
      initial={initial.summary}
      meta={{
        source: initial.source,
        snapshotDate:
          initial.source === "snapshot" ? initial.snapshotDate : undefined,
      }}
    />
  );
}
