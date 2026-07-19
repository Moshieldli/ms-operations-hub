import { getFleetCounts } from "@/lib/service/fleetCounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/fleet-counts/services — the service_total number ALONE (no header,
 * no second column), for a sheet cell that already has its own header.
 * Totals only, no names.
 *
 * ⚠️ Dot-free path on purpose — see the sibling `customers/route.ts`. The public
 * URL `/api/fleet-counts/services.csv` reaches this via a `beforeFiles` rewrite.
 */
export async function GET() {
  try {
    const c = await getFleetCounts();
    return new Response(`${c.serviceTotal}\n`, {
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
