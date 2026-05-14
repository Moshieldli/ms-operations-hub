import { fetchAllCustomers } from "./customers";
import { fetchContractsForCustomers } from "./contracts";
import { fetchTagsForPestContracts } from "./contract-tags";
import { bucketFor, CURRENT_YEAR } from "./categorize";
import { pocomosOffice } from "./client";
import type { Bucket, PocomosContract, PocomosCustomer } from "./types";

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

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  summary: SalesSummary;
  fetchedAt: number;
}

// Module-level cache. On Vercel, persists for the lifetime of a warm Lambda
// instance (often much longer than the 10-min TTL when traffic is steady).
let cache: CacheEntry | null = null;
let inFlight: Promise<SalesSummary> | null = null;

export function clearSalesCache() {
  cache = null;
}

export async function getSalesSummary(
  options: { force?: boolean } = {}
): Promise<SalesSummary> {
  const now = Date.now();
  if (!options.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.summary;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const summary = await buildSummary();
      cache = { summary, fetchedAt: Date.now() };
      return summary;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function statusOf(s: unknown): string {
  return String(s || "").toLowerCase();
}

async function buildSummary(): Promise<SalesSummary> {
  const t0 = Date.now();
  const year = CURRENT_YEAR;

  // 1. All customers (active + cancelled + on-hold). We need cancelled/on-hold
  //    only as headline counts; we don't fetch their contracts/tags.
  const allCustomers: PocomosCustomer[] = await fetchAllCustomers();

  const activeCustomers = allCustomers.filter((c) => statusOf(c.status) === "active");
  // Pocomos uses "Inactive" for cancelled/lost customers; no "Cancelled" status
  // exists at the customer level. We treat Inactive as cancelled for headline
  // reporting — this matches what the operations team thinks of as "cancelled".
  const cancelledCount = allCustomers.filter((c) => statusOf(c.status) === "inactive").length;
  const onHoldCount = allCustomers.filter((c) => statusOf(c.status) === "on-hold").length;

  const activeIds = activeCustomers.map((c) => c.id);

  // 2. Contracts for every active customer. Need all contracts (including
  //    cancelled ones) because prior-year tags live on prior-year contracts.
  const contractsResult = await fetchContractsForCustomers(activeIds);
  const contractsByCustomer = contractsResult.results;
  const contractsFailed = contractsResult.failures.length;
  const contractsFetched = contractsByCustomer.size;

  // 3. Collect every pest_contract.id we'll need tags for. Map back to the
  //    customer so we can union tags per-customer afterwards.
  const pestIdToCustomer = new Map<string | number, string | number>();
  let activeServices = 0;
  for (const customer of activeCustomers) {
    const contracts: PocomosContract[] = contractsByCustomer.get(customer.id) || [];
    for (const contract of contracts) {
      const pc = contract.pest_contract as { id?: string | number } | undefined;
      const pestId = pc?.id;
      if (pestId != null && !pestIdToCustomer.has(pestId)) {
        pestIdToCustomer.set(pestId, customer.id);
      }
      if (statusOf(contract.status) === "active") {
        activeServices++;
      }
    }
  }

  // 4. Fetch tags for every pest_contract via the new endpoint.
  const pestIds = Array.from(pestIdToCustomer.keys());
  const tagsResult = await fetchTagsForPestContracts(pestIds);
  const tagsByPestId = tagsResult.results;
  const tagsFailed = tagsResult.failures.length;
  const tagsFetched = tagsByPestId.size;

  // 5. Union tags per customer.
  const tagsByCustomer = new Map<string | number, Set<string>>();
  for (const [pestId, customerId] of pestIdToCustomer.entries()) {
    const tags = tagsByPestId.get(pestId) || [];
    let set = tagsByCustomer.get(customerId);
    if (!set) {
      set = new Set<string>();
      tagsByCustomer.set(customerId, set);
    }
    for (const t of tags) set.add(t);
  }

  // 6. Bucket each active customer.
  const buckets: Record<Bucket, number> = {
    NEW: 0,
    RETURNING: 0,
    RETAINED: 0,
    AT_RISK: 0,
    CANCELLED: cancelledCount,
  };
  let auto = 0;
  let seb = 0;
  let eb = 0;
  let untagged = 0;
  let uncategorized = 0;
  const untaggedSampleIds: string[] = [];
  const uncategorizedSampleIds: string[] = [];

  for (const customer of activeCustomers) {
    const tags = tagsByCustomer.get(customer.id);
    if (!tags || tags.size === 0) {
      untagged++;
      if (untaggedSampleIds.length < 10) untaggedSampleIds.push(String(customer.id));
      continue;
    }
    const b = bucketFor(tags, year);
    if (!b) {
      uncategorized++;
      if (uncategorizedSampleIds.length < 10)
        uncategorizedSampleIds.push(String(customer.id));
      continue;
    }
    buckets[b]++;
    if (b === "RETAINED") {
      if (tags.has(`${year} - Auto`)) auto++;
      else if (tags.has(`${year} - SEB`)) seb++;
      else if (tags.has(`${year} - EB`)) eb++;
    }
  }

  return {
    asOf: new Date().toISOString(),
    year,
    source: { kind: "pocomos-api", office: pocomosOffice() },
    totals: {
      activeCustomers: activeCustomers.length,
      activeServices,
      cancelledCustomers: cancelledCount,
      onHoldCustomers: onHoldCount,
    },
    buckets,
    retainedSubtypes: { auto, seb, eb },
    debug: {
      untagged,
      uncategorized,
      untaggedSampleIds,
      uncategorizedSampleIds,
      contractsFetched,
      contractsFailed,
      tagsFetched,
      tagsFailed,
      fetchDurationMs: Date.now() - t0,
    },
  };
}
