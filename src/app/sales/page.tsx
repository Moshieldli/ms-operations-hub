import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SalesView } from "@/components/sales-view";
import { loadInitialSales } from "@/lib/sales-data";

export const dynamic = "force-dynamic";
// Snapshot-first: the common path is a fast DB read. maxDuration stays high to
// cover the fallback live build when no snapshot exists yet.
export const maxDuration = 300;

export default async function SalesPage() {
  const initial = await loadInitialSales();

  if (!initial.ok) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live customer pipeline from Pocomos · year tags.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Couldn&rsquo;t load sales data</CardTitle>
            <CardDescription>{initial.error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            No snapshot yet and the live Pocomos build failed — the API may be
            rate-limited or credentials may be missing.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SalesView
      initial={initial.summary}
      meta={{
        source: initial.source,
        snapshotDate:
          initial.source === "snapshot" ? initial.snapshotDate : undefined,
      }}
    />
  );
}
