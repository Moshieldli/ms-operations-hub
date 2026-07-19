"use client";

import { useEffect } from "react";

/**
 * Reload the whole page on an interval. The TV screens are unattended and
 * Yodeck never refreshes a webpage widget on its own, so the page refreshes
 * itself; a full reload re-runs the server render, which is where the data is.
 */
export function useAutoReload(ms: number) {
  useEffect(() => {
    const t = setInterval(() => window.location.reload(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Every TV screen refreshes on the same 10-minute cadence. */
export const TV_REFRESH_MS = 10 * 60 * 1000;
