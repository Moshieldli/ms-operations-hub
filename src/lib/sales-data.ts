import { getSalesSummary, type SalesSummary } from "@/lib/pocomos";

export type { SalesSummary };

export type LoadResult =
  | { ok: true; summary: SalesSummary }
  | { ok: false; error: string };

export async function loadSalesSummary(): Promise<LoadResult> {
  try {
    const summary = await getSalesSummary();
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
