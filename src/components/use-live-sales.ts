"use client";

import { useCallback, useEffect, useState } from "react";
import type { SalesSummary } from "@/lib/sales-data";

// Mirrors sales-data's old REFRESH_INTERVAL_MS (5 min). Lives here so this
// client hook doesn't import the server-only sales-data module at runtime.
const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type SalesMeta = {
  source: "snapshot" | "live";
  snapshotDate?: string;
};

export type LiveSalesState = {
  summary: SalesSummary;
  /** true once a live /api/sales/live response has been applied. */
  live: boolean;
  /** true while a live fetch is in flight. */
  refreshing: boolean;
  /** ISO timestamp of the last applied live summary, or null before first live. */
  liveAsOf: string | null;
  error: string | null;
};

/**
 * Snapshot-first live revalidation. Starts from the server-provided summary
 * (a snapshot, or a live build when no snapshot exists), then fetches
 * /api/sales/live after paint and on a 5-min interval, swapping fresh numbers
 * in when they arrive. Never throws — a failed live fetch keeps the last good
 * data and surfaces `error`.
 */
export function useLiveSales(
  initial: SalesSummary,
  meta: SalesMeta
): LiveSalesState {
  const [summary, setSummary] = useState<SalesSummary>(initial);
  const [live, setLive] = useState(meta.source === "live");
  const [liveAsOf, setLiveAsOf] = useState<string | null>(
    meta.source === "live" ? initial.asOf || null : null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/sales/live", { cache: "no-store" });
      const data = (await res.json()) as {
        ok: boolean;
        summary?: SalesSummary;
        error?: string;
      };
      if (data.ok && data.summary) {
        setSummary(data.summary);
        setLive(true);
        setLiveAsOf(data.summary.asOf || new Date().toISOString());
        setError(null);
      } else {
        setError(data.error || "live refresh failed");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, LIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { summary, live, refreshing, liveAsOf, error };
}
