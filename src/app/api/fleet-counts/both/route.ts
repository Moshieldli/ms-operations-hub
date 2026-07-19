import { getFleetCounts } from "@/lib/service/fleetCounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/fleet-counts/both — public CSV for Google Sheets IMPORTDATA. Header
 * row + one value row, so the two numbers land in adjacent cells (e.g.
 * `=IMPORTDATA(url)` in A1 → values in A2 and B2). Totals only, no names.
 *
 * ⚠️ Dot-free path on purpose — see `customers/route.ts`. The public URL
 * `/api/fleet-counts.csv` reaches this via a `beforeFiles` rewrite.
 */
export async function GET() {
  try {
    const c = await getFleetCounts();
    const csv = `customer_total,service_total\n${c.customerTotal},${c.serviceTotal}\n`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response(`error,${(e as Error).message}\n`, {
      status: 500,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }
}
