import { getDataset, clearDatasetCache } from "./dataset";
import { bucketFor, CURRENT_YEAR } from "./categorize";
import { pocomosOffice } from "./client";
import type { NormalizedCustomer, PocomosDataset } from "./dataset-types";
import type { Bucket } from "./types";

export interface CancelledBreakdown {
  total: number;
  thisYear: number;
  lastYear: number;
  earlier: number;
  unknown: number;
  byYear: Record<string, number>;
}

export interface SalesSummary {
  asOf: string;
  year: string;
  source: { kind: "pocomos-api"; office: string };
  totals: {
    activeCustomers: number;
    activeServices: number;
    cancelledCustomers: number;
    onHoldCustomers: number;
  };
  buckets: Record<Bucket, number>;
  retainedSubtypes: { auto: number; seb: number; eb: number };
  cancelled: CancelledBreakdown;
  debug: {
    untagged: number;
    uncategorized: number;
    untaggedSampleIds: string[];
    uncategorizedSampleIds: string[];
    contractsFetched: number;
    contractsFailed: number;
    tagsFetched: number;
    tagsFailed: number;
    fetchDurationMs: number;
  };
}

export function clearSalesCache() {
  clearDatasetCache();
}

export async function getSalesSummary(
  options: { force?: boolean } = {}
): Promise<SalesSummary> {
  const dataset = await getDataset(options);
  return summarize(dataset);
}

function parseYear(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : null;
}

export function summarize(dataset: PocomosDataset): SalesSummary {
  const year = CURRENT_YEAR;
  const yearNum = parseInt(year, 10);

  const buckets: Record<Bucket, number> = {
    NEW: 0,
    RETURNING: 0,
    RETAINED: 0,
    AT_RISK: 0,
    CANCELLED: 0,
  };
  let auto = 0;
  let seb = 0;
  let eb = 0;
  let activeServices = 0;
  let untagged = 0;
  let uncategorized = 0;
  const untaggedSampleIds: string[] = [];
  const uncategorizedSampleIds: string[] = [];

  const cancelledByYear: Record<string, number> = {};
  let cancelledTotal = 0;
  let cancelledUnknown = 0;

  for (const customer of dataset.customers) {
    const status = customer.status.toLowerCase();
    if (status === "active") {
      // Active services = active-status contracts.
      for (const c of customer.contracts) {
        if (String(c.status || "").toLowerCase() === "active") activeServices++;
      }
      const tagSet = new Set(customer.tags);
      if (tagSet.size === 0) {
        untagged++;
        if (untaggedSampleIds.length < 10)
          untaggedSampleIds.push(String(customer.id));
        continue;
      }
      const b = bucketFor(tagSet, year);
      if (!b) {
        uncategorized++;
        if (uncategorizedSampleIds.length < 10)
          uncategorizedSampleIds.push(String(customer.id));
        continue;
      }
      buckets[b]++;
      if (b === "RETAINED") {
        if (tagSet.has(`${year} - Auto`)) auto++;
        else if (tagSet.has(`${year} - SEB`)) seb++;
        else if (tagSet.has(`${year} - EB`)) eb++;
      }
    } else if (status === "inactive") {
      cancelledTotal++;
      const y = parseYear(customer.cancelDate);
      if (y == null) {
        cancelledUnknown++;
      } else {
        const key = String(y);
        cancelledByYear[key] = (cancelledByYear[key] || 0) + 1;
      }
    }
  }

  buckets.CANCELLED = cancelledTotal;

  const cancelled: CancelledBreakdown = {
    total: cancelledTotal,
    thisYear: cancelledByYear[String(yearNum)] || 0,
    lastYear: cancelledByYear[String(yearNum - 1)] || 0,
    earlier: 0,
    unknown: cancelledUnknown,
    byYear: cancelledByYear,
  };
  for (const [k, v] of Object.entries(cancelledByYear)) {
    const ky = parseInt(k, 10);
    if (Number.isFinite(ky) && ky < yearNum - 1) cancelled.earlier += v;
  }

  return {
    asOf: dataset.asOf,
    year,
    source: { kind: "pocomos-api", office: pocomosOffice() },
    totals: {
      activeCustomers: dataset.diagnostics.activeCount,
      activeServices,
      cancelledCustomers: dataset.diagnostics.inactiveCount,
      onHoldCustomers: dataset.diagnostics.onHoldCount,
    },
    buckets,
    retainedSubtypes: { auto, seb, eb },
    cancelled,
    debug: {
      untagged,
      uncategorized,
      untaggedSampleIds,
      uncategorizedSampleIds,
      contractsFetched: dataset.diagnostics.contractsFetched,
      contractsFailed: dataset.diagnostics.contractsFailed,
      tagsFetched: dataset.diagnostics.tagsFetched,
      tagsFailed: dataset.diagnostics.tagsFailed,
      fetchDurationMs: dataset.diagnostics.fetchDurationMs,
    },
  };
}

export type FilterPredicate = (c: NormalizedCustomer) => boolean;

/**
 * Future filtering hook — return customers matching a predicate against the
 * cached dataset. Not used by the sales page yet, but exposed so filter UIs
 * (or a /api/customers endpoint) can build on the same data layer.
 */
export async function filterCustomers(
  predicate: FilterPredicate
): Promise<NormalizedCustomer[]> {
  const ds = await getDataset();
  return ds.customers.filter(predicate);
}
