"use client";

import { useEffect, useState } from "react";

function relativeLabel(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (m < 60) return remSec ? `${m}m ${remSec}s ago` : `${m}m ago`;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return remMin ? `${h}h ${remMin}m ago` : `${h}h ago`;
}

export function RefreshedAt({
  asOf,
  className,
}: {
  asOf: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now == null) {
    return <span className={className}>Updated just now</span>;
  }
  const seconds = Math.max(0, Math.floor((now - new Date(asOf).getTime()) / 1000));
  return <span className={className}>Updated {relativeLabel(seconds)}</span>;
}
