import type { Bucket, CustomerRecord, SalesSummary, SheetParseResult } from "./types";

const CURRENT_YEAR = String(new Date().getFullYear());

function bucketFor(yearTags: Set<string>, year: string): Bucket | null {
  const hasNew = yearTags.has(`${year} - New Sale`);
  const hasRenewed = yearTags.has(`${year} - Renewed`);
  const hasAuto = yearTags.has(`${year} - Auto`);
  const hasSEB = yearTags.has(`${year} - SEB`);
  const hasEB = yearTags.has(`${year} - EB`);
  const hasOther =
    yearTags.has(`${year} - Prepaid`) || yearTags.has(`${year} - Committed`);
  const hasContinuation = hasAuto || hasSEB || hasEB || hasOther;
  const hasPriorYear = Array.from(yearTags).some((t) => {
    const m = t.match(/^(\d{4}) -/);
    return m != null && m[1] < year;
  });

  if (hasNew) return "NEW";
  if (hasRenewed) return "RETURNING";
  if (hasContinuation) return "RETAINED";
  if (hasPriorYear) return "AT_RISK";
  return null;
}

export interface CategorizeOptions {
  year?: string;
  now?: Date;
  sheetId: string;
  tab: string;
}

export function categorizeFromSheet(
  parsed: SheetParseResult,
  opts: CategorizeOptions
): SalesSummary {
  const year = opts.year || CURRENT_YEAR;
  const now = opts.now || new Date();
  const buckets: Record<Bucket, number> = {
    NEW: 0,
    RETURNING: 0,
    RETAINED: 0,
    AT_RISK: 0,
    CANCELLED: 0, // Not derivable from year-tag-only model; surfaced as 0 for V1.
  };
  let auto = 0,
    seb = 0,
    eb = 0;
  let untagged = 0;
  let uncategorized = 0;
  const untaggedSample: string[] = [];
  const uncategorizedSample: string[] = [];

  for (const customer of parsed.customers.values()) {
    if (!customer.yearTags.size) {
      untagged++;
      if (untaggedSample.length < 10) untaggedSample.push(customer.customerNumber);
      continue;
    }
    const b = bucketFor(customer.yearTags, year);
    if (!b) {
      uncategorized++;
      if (uncategorizedSample.length < 10)
        uncategorizedSample.push(customer.customerNumber);
      continue;
    }
    buckets[b]++;
    if (b === "RETAINED") {
      if (customer.yearTags.has(`${year} - Auto`)) auto++;
      else if (customer.yearTags.has(`${year} - SEB`)) seb++;
      else if (customer.yearTags.has(`${year} - EB`)) eb++;
    }
  }

  return {
    asOf: now.toISOString(),
    year,
    source: {
      kind: "google-sheets-csv",
      sheetId: opts.sheetId,
      tab: opts.tab,
    },
    totals: {
      activeCustomers: parsed.customers.size,
      activeServices: parsed.activeServiceRows,
      junkRowsSkipped: parsed.junkRowsSkipped,
      totalRowsSeen: parsed.totalRows,
    },
    buckets,
    retainedSubtypes: { auto, seb, eb },
    debug: {
      untagged,
      uncategorized,
      untaggedSampleIds: untaggedSample,
      uncategorizedSampleIds: uncategorizedSample,
    },
  };
}

/** Helper: log untagged + uncategorized samples with their raw cells for debugging. */
export function debugReport(
  parsed: SheetParseResult,
  summary: SalesSummary
): string {
  const lines: string[] = [];
  lines.push(
    `Active customers: ${summary.totals.activeCustomers} | services: ${summary.totals.activeServices} | junk skipped: ${summary.totals.junkRowsSkipped}`
  );
  lines.push(
    `Buckets: NEW=${summary.buckets.NEW} RETURNING=${summary.buckets.RETURNING} RETAINED=${summary.buckets.RETAINED} (Auto ${summary.retainedSubtypes.auto} / SEB ${summary.retainedSubtypes.seb} / EB ${summary.retainedSubtypes.eb}) AT_RISK=${summary.buckets.AT_RISK}`
  );
  lines.push(
    `Debug: ${summary.debug.untagged} untagged, ${summary.debug.uncategorized} uncategorized`
  );
  if (summary.debug.untaggedSampleIds.length) {
    lines.push("Untagged sample (id → raw tags cell):");
    for (const id of summary.debug.untaggedSampleIds) {
      const rec = parsed.customers.get(id);
      lines.push(`  ${id}: ${(rec?.rawTagsCells || []).join(" | ").slice(0, 200)}`);
    }
  }
  if (summary.debug.uncategorizedSampleIds.length) {
    lines.push("Uncategorized sample (id → year tags):");
    for (const id of summary.debug.uncategorizedSampleIds) {
      const rec = parsed.customers.get(id);
      lines.push(`  ${id}: [${Array.from(rec?.yearTags || []).join(", ")}]`);
    }
  }
  return lines.join("\n");
}
