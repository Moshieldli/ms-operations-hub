import { initSchema, sql } from "./db";
import {
  fetchAllCustomers,
  fetchContractsForCustomers,
  fetchTagsForPestContracts,
} from "./pocomos";
import type {
  PocomosContract,
  PocomosCustomer,
} from "./pocomos";

/**
 * Overnight enrichment of Inactive (and On-Hold) customers.
 *
 * Why: the live /sales path only fetches contracts+tags for Active customers
 * (active full, inactive slim) so the page stays under Vercel's function
 * budget. The cron fills in tags/contracts/marketing/dates for the remaining
 * customers and upserts them into the `customers` Postgres table so future
 * filter UIs can read historical-cohort data without re-hitting Pocomos.
 *
 * Resumable: we sort candidates by oldest `refreshed_at` (NULL first) and
 * stop when the caller signals time pressure. The next cron picks up where
 * we left off.
 */

function statusOf(s: unknown) {
  return String(s || "").toLowerCase();
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function pick(obj: PocomosCustomer, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return undefined;
}

function pickServiceType(pc: PocomosContract["pest_contract"]): string | null {
  const t = (pc as Record<string, unknown> | undefined)?.service_type;
  if (t && typeof t === "object") {
    const name = (t as Record<string, unknown>).name;
    if (name) return String(name);
  }
  return null;
}

interface NormalizedContractJson {
  contractId: string | number;
  pestContractId: string | number | null;
  status: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  dateCreated: string | null;
  dateCancelled: string | null;
  serviceType: string | null;
  serviceFrequency: string | null;
  tags: string[];
}

async function pocomosIdsAlreadyEnriched(): Promise<Set<string>> {
  const rows = (await sql`
    SELECT pocomos_id FROM customers WHERE depth = 'full'
  `) as Array<{ pocomos_id: string }>;
  return new Set(rows.map((r) => r.pocomos_id));
}

export interface EnrichmentResult {
  candidates: number;
  enriched: number;
  failedContracts: number;
  failedTags: number;
  durationMs: number;
  reachedEndOfQueue: boolean;
}

export interface EnrichmentOptions {
  /** Stop when at least this many ms have elapsed total (incl. fetch). */
  budgetMs?: number;
  /** Cap on customers to enrich in this invocation. */
  maxCustomers?: number;
}

/**
 * Enrich a batch of non-Active customers. Stops early on time budget or
 * customer cap. Callers (the cron) pass remaining budget excluding the
 * snapshot phase's elapsed time.
 */
export async function enrichInactiveCustomers(
  options: EnrichmentOptions = {}
): Promise<EnrichmentResult> {
  const t0 = Date.now();
  const budgetMs = options.budgetMs ?? 240_000;
  const maxCustomers = options.maxCustomers ?? 5000;
  await initSchema();

  // 1. Get current Pocomos customer list and figure out which non-Active
  //    customers still need enrichment.
  const allRaw = await fetchAllCustomers();
  const candidates = allRaw.filter(
    (c) => statusOf(c.status) !== "active"
  );
  const already = await pocomosIdsAlreadyEnriched();
  const queue: PocomosCustomer[] = [];
  for (const c of candidates) {
    if (!already.has(String(c.id))) queue.push(c);
  }
  const candidatesCount = candidates.length;

  // Trim to per-run cap.
  const work = queue.slice(0, maxCustomers);
  if (work.length === 0) {
    return {
      candidates: candidatesCount,
      enriched: 0,
      failedContracts: 0,
      failedTags: 0,
      durationMs: Date.now() - t0,
      reachedEndOfQueue: true,
    };
  }

  // 2. Fetch contracts for every queued customer (rolling pool, 5 concurrent).
  const ids = work.map((c) => c.id);
  const contractsResult = await fetchContractsForCustomers(ids);
  const contractsByCustomer = contractsResult.results;
  const failedContracts = contractsResult.failures.length;

  // 3. Collect pest_contract.ids, fetch tags. Same approach as the active path.
  const pestIds: Array<string | number> = [];
  const seenPestIds = new Set<string | number>();
  for (const id of ids) {
    const contracts = contractsByCustomer.get(id) || [];
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
  const failedTags = tagsResult.failures.length;

  // 4. Upsert each enriched customer. Yield to time budget between rows.
  let enriched = 0;
  for (const raw of work) {
    const elapsed = Date.now() - t0;
    if (elapsed > budgetMs) break;

    const status = String(raw.status || "");
    const lower = statusOf(status);
    const firstName = pick(raw, "firstName", "first_name");
    const lastName = pick(raw, "lastName", "last_name");
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || String(raw.id);

    const rawContracts: PocomosContract[] =
      contractsByCustomer.get(raw.id) || [];
    const normalized: NormalizedContractJson[] = rawContracts.map((c) => {
      const pc = c.pest_contract as Record<string, unknown> | undefined;
      const pestContractId =
        (pc?.id as string | number | undefined) ?? null;
      return {
        contractId: ((c as Record<string, unknown>).id as
          | string
          | number) ?? "",
        pestContractId,
        status: strOrNull(c.status),
        dateStart: strOrNull((c as Record<string, unknown>).date_start),
        dateEnd: strOrNull((c as Record<string, unknown>).date_end),
        dateCreated: strOrNull(c.date_created),
        dateCancelled: strOrNull(
          (c as Record<string, unknown>).date_cancelled
        ),
        serviceType: pickServiceType(c.pest_contract),
        serviceFrequency: strOrNull(
          (pc?.service_frequency as string | undefined) ??
            ((c as Record<string, unknown>).service_frequency as
              | string
              | undefined)
        ),
        tags:
          pestContractId != null
            ? tagsByPestId.get(pestContractId) ?? []
            : [],
      };
    });
    const unionTags = new Set<string>();
    for (const nc of normalized) for (const t of nc.tags) unionTags.add(t);

    const lastServiceDate =
      pick(raw, "lastServiceDate", "last_service_date") ?? null;
    const cancelDate = lower === "inactive" ? lastServiceDate : null;

    await sql`
      INSERT INTO customers (
        pocomos_id, status, full_name, first_name, last_name,
        email, phone, zip,
        date_created, last_service_date, next_service_date, cancel_date,
        sales_status, marketing_type,
        depth, tags, contracts, refreshed_at
      ) VALUES (
        ${String(raw.id)}, ${status}, ${fullName}, ${firstName ?? null}, ${lastName ?? null},
        ${pick(raw, "emailAddress", "email_address", "email") ?? null},
        ${pick(raw, "phone", "phoneNumber", "phone_number") ?? null},
        ${pick(raw, "postalCode", "postal_code", "zip") ?? null},
        ${pick(raw, "dateCreated", "date_created") ?? null},
        ${lastServiceDate},
        ${pick(raw, "nextServiceDate", "next_service_date") ?? null},
        ${cancelDate},
        ${pick(raw, "salesStatus", "sales_status") ?? null},
        ${pick(raw, "marketingType", "marketing_type") ?? null},
        ${'full'},
        ${JSON.stringify(Array.from(unionTags))}::jsonb,
        ${JSON.stringify(normalized)}::jsonb,
        NOW()
      )
      ON CONFLICT (pocomos_id) DO UPDATE SET
        status = EXCLUDED.status,
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        zip = EXCLUDED.zip,
        date_created = EXCLUDED.date_created,
        last_service_date = EXCLUDED.last_service_date,
        next_service_date = EXCLUDED.next_service_date,
        cancel_date = EXCLUDED.cancel_date,
        sales_status = EXCLUDED.sales_status,
        marketing_type = EXCLUDED.marketing_type,
        depth = EXCLUDED.depth,
        tags = EXCLUDED.tags,
        contracts = EXCLUDED.contracts,
        refreshed_at = NOW()
    `;
    enriched++;
  }

  return {
    candidates: candidatesCount,
    enriched,
    failedContracts,
    failedTags,
    durationMs: Date.now() - t0,
    reachedEndOfQueue: enriched >= queue.length,
  };
}
