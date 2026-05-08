import type {
  Bucket,
  CategorizedSummary,
  PocomosContract,
  PocomosCustomer,
} from "./types";
import { resolveCustomerNumber, tagsForContract, tagsForCustomer } from "./tags";

const CURRENT_YEAR = String(new Date().getFullYear());

function parsePocomoDate(s: unknown): Date | null {
  if (!s) return null;
  if (s instanceof Date) return s;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

/** Sat-Fri week per the existing dashboard convention. */
export function startOfSaturdayWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
  return date;
}

function bucketFor(tags: Set<string>, year: string): Bucket | null {
  const hasNew = tags.has(`${year} - New Sale`);
  const hasRenewed = tags.has(`${year} - Renewed`);
  const hasAuto = tags.has(`${year} - Auto`);
  const hasSEB = tags.has(`${year} - SEB`);
  const hasEB = tags.has(`${year} - EB`);
  const hasOther =
    tags.has(`${year} - Prepaid`) || tags.has(`${year} - Committed`);
  const hasContinuation = hasAuto || hasSEB || hasEB || hasOther;
  const hasPriorYear = Array.from(tags).some((t) => {
    const m = t.match(/^(\d{4}) -/);
    return m != null && m[1] < year;
  });

  if (hasNew) return "NEW";
  if (hasRenewed) return "RETURNING";
  if (hasContinuation) return "RETAINED";
  if (hasPriorYear) return "AT_RISK";
  return null;
}

export interface CategorizeInput {
  customers: PocomosCustomer[];
  contractsByApiId: Map<string | number, PocomosContract[]>;
  tagNameMap: Map<string | number, string>;
  year?: string;
  now?: Date;
  diagnostics?: Partial<CategorizedSummary["diagnostics"]>;
}

export function categorize(input: CategorizeInput): CategorizedSummary {
  const year = input.year || CURRENT_YEAR;
  const now = input.now || new Date();
  const weekStart = startOfSaturdayWeek(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const activeIds = new Set<string>();
  const cancelledIds = new Set<string>();
  const onHoldIds = new Set<string>();
  const customerTags = new Map<string, Set<string>>();
  const earliestThisYearByMatchId = new Map<string, Date>();
  let activeServices = 0;
  let newServicesWeek = 0;
  let newServicesToday = 0;
  let detectedSource = "n/a";
  let sampleProfileKeys: string[] = [];
  let firstContractLogged = false;

  for (const customer of input.customers) {
    const apiId = customer.id;
    const contracts = input.contractsByApiId.get(apiId) || [];
    const { value: matchableId, source } = resolveCustomerNumber(
      customer,
      contracts
    );
    if (detectedSource === "n/a" && contracts.length) detectedSource = source;
    if (
      !firstContractLogged &&
      contracts.length &&
      contracts[0].profile
    ) {
      sampleProfileKeys = Object.keys(contracts[0].profile || {});
      firstContractLogged = true;
    }

    const baseTags = new Set<string>();
    for (const t of tagsForCustomer(customer, input.tagNameMap)) baseTags.add(t);
    customerTags.set(matchableId, baseTags);

    const customerStatus = String(customer.status || "").toLowerCase();

    if (!contracts.length) {
      // No contracts; categorize on customer-level data only.
      if (customerStatus === "active") activeIds.add(matchableId);
      else if (customerStatus === "on-hold") onHoldIds.add(matchableId);
      continue;
    }

    for (const contract of contracts) {
      const status = String(
        contract.status || customer.status || ""
      ).toLowerCase();
      const sales = String(
        contract.sales_status ||
          contract.salesStatus ||
          customer.salesStatus ||
          customer.sales_status ||
          ""
      ).toLowerCase();

      const set = customerTags.get(matchableId)!;
      for (const t of tagsForContract(contract, input.tagNameMap)) set.add(t);

      const creation = parsePocomoDate(
        contract.date_created ||
          contract.pest_contract?.date_created ||
          customer.dateCreated ||
          customer.date_created
      );
      if (creation && creation.getFullYear().toString() === year) {
        const cur = earliestThisYearByMatchId.get(matchableId);
        if (!cur || creation < cur) {
          earliestThisYearByMatchId.set(matchableId, creation);
        }
      }

      if (sales.includes("cancel")) {
        cancelledIds.add(matchableId);
        continue;
      }
      if (status === "active") {
        activeIds.add(matchableId);
        activeServices++;
        if (creation) {
          if (creation >= weekStart) newServicesWeek++;
          if (creation >= todayStart) newServicesToday++;
        }
      } else if (status === "on-hold") {
        onHoldIds.add(matchableId);
      }
    }
  }

  const buckets: Record<Bucket, number> = {
    NEW: 0,
    RETURNING: 0,
    RETAINED: 0,
    AT_RISK: 0,
    CANCELLED: cancelledIds.size,
  };
  let auto = 0,
    seb = 0,
    eb = 0;
  let categorized = 0;
  const newCustomersWeekSet = new Set<string>();
  const newCustomersTodaySet = new Set<string>();

  for (const id of activeIds) {
    const tags = customerTags.get(id) || new Set<string>();
    const b = bucketFor(tags, year);
    if (b) {
      buckets[b]++;
      categorized++;
      if (b === "RETAINED") {
        if (tags.has(`${year} - Auto`)) auto++;
        else if (tags.has(`${year} - SEB`)) seb++;
        else if (tags.has(`${year} - EB`)) eb++;
      }
      if (b === "NEW") {
        const earliest = earliestThisYearByMatchId.get(id);
        if (earliest) {
          if (earliest >= weekStart) newCustomersWeekSet.add(id);
          if (earliest >= todayStart) newCustomersTodaySet.add(id);
        }
      }
    }
  }

  const summary: CategorizedSummary = {
    asOf: now.toISOString(),
    year,
    totals: {
      activeCustomers: activeIds.size,
      activeServices,
      cancelledCustomers: cancelledIds.size,
      onHoldCustomers: onHoldIds.size,
      categorized,
    },
    buckets,
    retainedSubtypes: { auto, seb, eb },
    thisWeek: {
      weekStart: weekStart.toISOString(),
      newCustomers: newCustomersWeekSet.size,
      newServices: newServicesWeek,
      newCustomersToday: newCustomersTodaySet.size,
      newServicesToday: newServicesToday,
    },
    diagnostics: {
      totalCustomersFromApi: input.diagnostics?.totalCustomersFromApi ?? 0,
      contractsFetched: input.diagnostics?.contractsFetched ?? 0,
      contractsFailed: input.diagnostics?.contractsFailed ?? 0,
      customerNumberSource: detectedSource,
      sampleContractProfileKeys: sampleProfileKeys,
      fetchDurationMs: input.diagnostics?.fetchDurationMs ?? 0,
    },
  };

  return summary;
}
