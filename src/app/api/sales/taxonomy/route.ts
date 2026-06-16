import { NextResponse } from "next/server";
import { getSalesTaxonomy } from "@/lib/sales-taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/sales/taxonomy
 *
 * Year-relative cancelled taxonomy (Not Renewed / Cancelled – All Time) plus the
 * "customers with issues" roster. Builds the live dataset (10-min cached) for
 * active tags and reads the enriched `customers` table for non-active tags.
 * The /sales page fetches this after its fast snapshot paint.
 */
export async function GET() {
  try {
    const taxonomy = await getSalesTaxonomy();
    return NextResponse.json({ ok: true, taxonomy });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
