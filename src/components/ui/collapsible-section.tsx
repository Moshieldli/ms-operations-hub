"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Collapsible section: header row (label + right-hand slot + chevron), collapsed
 * by default, click to expand. Built on native <details>/<summary> so keyboard,
 * screen readers and browser find-in-page work with no JS state.
 *
 * Shared by the /sales anomalies + missing-tags cards and the /service/resprays
 * per-tech weekly breakdown.
 */
export function CollapsibleSection({
  label,
  right,
  defaultOpen = false,
  className,
  children,
}: {
  label: React.ReactNode;
  /** Rendered right-aligned in the header — a count, a rate, badges. */
  right?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cn("group rounded-md border", className)} open={defaultOpen}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <div className="min-w-0 flex-1 text-sm font-medium">{label}</div>
        {right ? <div className="shrink-0 text-sm text-muted-foreground">{right}</div> : null}
      </summary>
      <div className="border-t px-3 pb-3 pt-2">{children}</div>
    </details>
  );
}

/** Collapse `children` behind a header only when `collapse` is true. */
export function MaybeCollapsible({
  collapse,
  label,
  right,
  children,
}: {
  collapse: boolean;
  label: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!collapse) return <>{children}</>;
  return (
    <CollapsibleSection label={label} right={right}>
      {children}
    </CollapsibleSection>
  );
}
