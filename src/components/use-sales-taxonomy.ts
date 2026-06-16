"use client";

import { useEffect, useState } from "react";
import type { SalesTaxonomy } from "@/lib/sales-taxonomy";

/**
 * Client fetch of the year-relative taxonomy (Not Renewed / Cancelled – All Time
 * / Customers-with-issues). Decoupled from the live-sales revalidation so the
 * snapshot paints instantly; the taxonomy cards fill in once this lands.
 */
export function useSalesTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<SalesTaxonomy | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sales/taxonomy", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; taxonomy?: SalesTaxonomy };
        if (!cancelled && data.ok && data.taxonomy) setTaxonomy(data.taxonomy);
      } catch {
        /* keep null — callers show a dash */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { taxonomy, loading };
}
