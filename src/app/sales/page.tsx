import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  categorizeFromSheet,
  fetchTagsCsv,
  parseTagsCsv,
  type SalesSummary,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";

const SHEET_ID = "1RGPeS5Mir2p3flA9oDOfaxyfC8xfoXyZnoe1kKCL11s";
const TAB = "Tags";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;

type LoadResult =
  | { ok: true; summary: SalesSummary }
  | { ok: false; error: string };

async function loadSummary(): Promise<LoadResult> {
  try {
    const csv = await fetchTagsCsv(CSV_URL);
    const parsed = parseTagsCsv(csv);
    const summary = categorizeFromSheet(parsed, { sheetId: SHEET_ID, tab: TAB });
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

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
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default async function SalesPage() {
  const result = await loadSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
        <p className="mt-1 text-muted-foreground">
          Customer pipeline by year-tag bucket.
        </p>
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
  const { totals, buckets, retainedSubtypes, debug, year, asOf } = summary;
  const retainedHint = `Auto ${retainedSubtypes.auto} · SEB ${retainedSubtypes.seb} · EB ${retainedSubtypes.eb}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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

      <p className="text-xs text-muted-foreground">
        As of {new Date(asOf).toLocaleString()} &middot; source:{" "}
        <code className="font-mono">{summary.source.tab}</code> tab
      </p>
    </>
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
    <div className="rounded-md border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {fmt(value)}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
