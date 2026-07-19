import { getFleetCounts } from "@/lib/service/fleetCounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/fleet-counts/customers — the customer_total number ALONE (no header,
 * no second column), for a sheet cell that already has its own header.
 * Totals only, no names.
 *
 * ⚠️ DOT-FREE PATH ON PURPOSE. The public URL is still
 * `/api/fleet-counts/customers.csv`, served here by a `beforeFiles` rewrite in
 * next.config.mjs. A route segment containing a dot builds and serves fine
 * under `next start` but **404s on Vercel** — the platform resolves
 * extension-looking paths against the static filesystem and never reaches the
 * function. See REFERENCE §5.14.
 */
export async function GET() {
  try {
    const c = await getFleetCounts();
    return new Response(`${c.customerTotal}\n`, {
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
