import { fetchAllCustomers } from "./customers";
import { fetchContractsForCustomers } from "./contracts";
import { fetchTagsForPestContracts } from "./contract-tags";
import type { PocomosContract, PocomosCustomer } from "./types";
import type {
  DatasetDiagnostics,
  NormalizedContract,
  NormalizedCustomer,
  PocomosDataset,
} from "./dataset-types";

function statusOf(s: unknown): string {
  return String(s || "").toLowerCase();
}

function pickString(obj: PocomosCustomer, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return undefined;
}

function pickServiceType(pc: PocomosContract["pest_contract"]): string | undefined {
  const t = (pc as Record<string, unknown> | undefined)?.service_type;
  if (t && typeof t === "object") {
    const name = (t as Record<string, unknown>).name;
    if (name) return String(name);
  }
  return undefined;
}

function normalizeContract(
  contract: PocomosContract,
  tagsByPestId: Map<string | number, string[]>
): NormalizedContract {
  const pc = contract.pest_contract;
  const pestContractId = (pc as { id?: string | number } | undefined)?.id;
  return {
    contractId: (contract as { id?: string | number }).id ?? "",
    pestContractId,
    status: contract.status ? String(contract.status) : undefined,
    dateStart: ((contract as Record<string, unknown>).date_start as string) ?? null,
    dateEnd: ((contract as Record<string, unknown>).date_end as string) ?? null,
    dateCreated: contract.date_created ?? null,
    dateCancelled:
      ((contract as Record<string, unknown>).date_cancelled as string) ?? null,
    serviceType: pickServiceType(pc),
    serviceFrequency:
      ((pc as Record<string, unknown> | undefined)?.service_frequency as
        | string
        | undefined) ?? (contract as Record<string, unknown>).service_frequency as
        | string
        | undefined,
    tags: pestContractId != null ? tagsByPestId.get(pestContractId) ?? [] : [],
  };
}

const TTL_MS = 10 * 60 * 1000;

let cache: { dataset: PocomosDataset; fetchedAt: number } | null = null;
let inFlight: Promise<PocomosDataset> | null = null;

export function clearDatasetCache() {
  cache = null;
}

export async function getDataset(
  options: { force?: boolean } = {}
): Promise<PocomosDataset> {
  if (!options.force && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.dataset;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const ds = await buildDataset();
      cache = { dataset: ds, fetchedAt: Date.now() };
      return ds;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function buildDataset(): Promise<PocomosDataset> {
  const t0 = Date.now();

  // 1. All customers (one call). For Inactive customers this returns a
  //    slim record (9 fields). For Active customers it's the rich record.
  const allRaw: PocomosCustomer[] = await fetchAllCustomers();

  let activeCount = 0;
  let inactiveCount = 0;
  let onHoldCount = 0;
  let otherStatusCount = 0;

  const activeCustomersRaw: PocomosCustomer[] = [];
  for (const c of allRaw) {
    const s = statusOf(c.status);
    if (s === "active") {
      activeCount++;
      activeCustomersRaw.push(c);
    } else if (s === "inactive") {
      inactiveCount++;
    } else if (s === "on-hold") {
      onHoldCount++;
    } else {
      otherStatusCount++;
    }
  }

  // 2. Contracts for Active customers only (Inactive depth = slim).
  const activeIds = activeCustomersRaw.map((c) => c.id);
  const contractsResult = await fetchContractsForCustomers(activeIds);
  const contractsByCustomer = contractsResult.results;
  const contractsFailed = contractsResult.failures.length;
  const contractsFetched = contractsByCustomer.size;

  // 3. Tags per pest_contract.id (for Active customers' contracts).
  const pestIds: Array<string | number> = [];
  const seenPestIds = new Set<string | number>();
  for (const customerId of activeIds) {
    const contracts = contractsByCustomer.get(customerId) || [];
    for (const c of contracts) {
      const pid = (c.pest_contract as { id?: string | number } | undefined)?.id;
      if (pid != null && !seenPestIds.has(pid)) {
        seenPestIds.add(pid);
        pestIds.push(pid);
      }
    }
  }
  const tagsResult = await fetchTagsForPestContracts(pestIds);
  const tagsByPestId = tagsResult.results;
  const tagsFailed = tagsResult.failures.length;
  const tagsFetched = tagsByPestId.size;

  // 4. Build normalized customers.
  const customers: NormalizedCustomer[] = [];
  let fullDepthCount = 0;
  let slimDepthCount = 0;

  for (const raw of allRaw) {
    const status = String(raw.status || "");
    const lower = statusOf(status);
    const firstName = pickString(raw, "firstName", "first_name");
    const lastName = pickString(raw, "lastName", "last_name");
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    const slimBase: NormalizedCustomer = {
      id: raw.id,
      firstName,
      lastName,
      fullName: fullName || String(raw.id),
      email: pickString(raw, "emailAddress", "email_address", "email"),
      phone: pickString(raw, "phone", "phoneNumber", "phone_number"),
      zip: pickString(raw, "postalCode", "postal_code", "zip"),
      status,
      dateCreated: pickString(raw, "dateCreated", "date_created") ?? null,
      lastServiceDate: pickString(raw, "lastServiceDate", "last_service_date") ?? null,
      nextServiceDate: pickString(raw, "nextServiceDate", "next_service_date") ?? null,
      cancelDate: null,
      salesStatus: pickString(raw, "salesStatus", "sales_status"),
      marketingType: pickString(raw, "marketingType", "marketing_type"),
      tags: [],
      contracts: [],
      depth: "slim",
    };

    if (lower === "inactive") {
      // Inactive: no contracts/tags fetched. Use lastServiceDate as the
      // cancel_date proxy (verified: no real cancel_date field exists at
      // customer level).
      slimBase.cancelDate = slimBase.lastServiceDate;
      slimDepthCount++;
      customers.push(slimBase);
      continue;
    }

    if (lower === "active") {
      const rawContracts: PocomosContract[] =
        contractsByCustomer.get(raw.id) || [];
      const normalizedContracts = rawContracts.map((c) =>
        normalizeContract(c, tagsByPestId)
      );
      const unionTags = new Set<string>();
      for (const nc of normalizedContracts) {
        for (const t of nc.tags) unionTags.add(t);
      }
      customers.push({
        ...slimBase,
        tags: Array.from(unionTags),
        contracts: normalizedContracts,
        depth: "full",
      });
      fullDepthCount++;
      continue;
    }

    // On-Hold / other statuses: keep slim for now (cron can backfill).
    slimDepthCount++;
    customers.push(slimBase);
  }

  const diagnostics: DatasetDiagnostics = {
    totalCustomers: allRaw.length,
    activeCount,
    inactiveCount,
    onHoldCount,
    otherStatusCount,
    fullDepthCount,
    slimDepthCount,
    contractsFetched,
    contractsFailed,
    tagsFetched,
    tagsFailed,
    fetchDurationMs: Date.now() - t0,
  };

  return {
    asOf: new Date().toISOString(),
    customers,
    diagnostics,
  };
}
