import { NextResponse } from "next/server";
import { getFleetCounts } from "@/lib/service/fleetCounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/fleet-counts — public, read-only. Totals only, no names.
 * Derived from the nightly-refreshed mosquito_service_status table.
 */
export async function GET() {
  try {
    const c = await getFleetCounts();
    return NextResponse.json(
      {
        customer_total: c.customerTotal,
        service_total: c.serviceTotal,
        weekly_count: c.weeklyCount,
        vans_estimate: c.vansEstimate,
        van_capacity_per_2wk: c.vanCapacityPer2wk,
        as_of: c.asOf,
      },
      { headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
