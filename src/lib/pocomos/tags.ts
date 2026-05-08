import { getJson, pocomosOffice } from "./client";
import type { PocomosContract, PocomosCustomer, PocomosTag } from "./types";

interface TagsListResponse {
  response?: PocomosTag[];
}

/**
 * Office tag dictionary: id -> name. Pocomos contracts/customers reference tags
 * either by full {id,name} object, by string name, or sometimes by bare id —
 * this map resolves the bare-id case.
 */
export async function fetchOfficeTagMap(): Promise<Map<string | number, string>> {
  const data = await getJson<TagsListResponse>(
    `/jwt/pronexis/tags/list/${pocomosOffice()}`
  );
  const map = new Map<string | number, string>();
  for (const t of data.response || []) {
    const name = String(t.name || t.tag || "").trim();
    if (!name) continue;
    map.set(t.id, name);
  }
  return map;
}

function tagsFromAnything(
  raw: unknown,
  tagNameMap: Map<string | number, string>
): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (!t) continue;
    if (typeof t === "string") {
      out.push(t.trim());
    } else if (typeof t === "object") {
      const obj = t as Record<string, unknown>;
      const name = (obj.name || obj.tag) as string | undefined;
      if (name) {
        out.push(String(name).trim());
      } else if (obj.id != null) {
        const resolved = tagNameMap.get(obj.id as string | number);
        if (resolved) out.push(resolved);
      }
    } else if (typeof t === "number") {
      const resolved = tagNameMap.get(t);
      if (resolved) out.push(resolved);
    }
  }
  return out.filter(Boolean);
}

export function tagsForCustomer(
  customer: PocomosCustomer,
  tagNameMap: Map<string | number, string>
): Set<string> {
  const set = new Set<string>();
  for (const t of tagsFromAnything(
    customer.tags || customer.tag_list || customer.customerTags,
    tagNameMap
  )) {
    set.add(t);
  }
  return set;
}

export function tagsForContract(
  contract: PocomosContract,
  tagNameMap: Map<string | number, string>
): string[] {
  const fromContract = tagsFromAnything(
    contract.tags || contract.tag_list,
    tagNameMap
  );
  const pc = contract.pest_contract || {};
  const fromPest = tagsFromAnything(pc.tags || pc.tag_list, tagNameMap);
  return [...fromContract, ...fromPest];
}

/**
 * Per the existing Apps Script gotcha: customer list returns 7-digit `id`,
 * but tag exports use a 6-digit `customer_number` that may live inside
 * contract.profile. This picks the user-facing number with fallbacks; if
 * everything is missing, falls back to `customer.id` so categorization still
 * runs (tag matching from the customer object itself will still work).
 */
export function resolveCustomerNumber(
  customer: PocomosCustomer,
  contracts: PocomosContract[]
): { value: string; source: string } {
  const direct =
    customer.customer_number ??
    customer.customerNumber ??
    (customer as Record<string, unknown>).customer_id ??
    (customer as Record<string, unknown>).customerId ??
    (customer as Record<string, unknown>).account_number ??
    (customer as Record<string, unknown>).accountNumber ??
    (customer as Record<string, unknown>).number ??
    (customer as Record<string, unknown>).code ??
    (customer as Record<string, unknown>).external_id ??
    (customer as Record<string, unknown>).externalId;
  if (direct != null && String(direct).trim() && String(direct).trim() !== "0") {
    return { value: String(direct).trim(), source: "customer.direct" };
  }

  for (const c of contracts) {
    const profile = c.profile || {};
    const pcandidate =
      (profile.customer_number as unknown) ??
      (profile.customerNumber as unknown) ??
      (profile.account_number as unknown) ??
      (profile.code as unknown) ??
      (profile.number as unknown);
    if (
      pcandidate != null &&
      String(pcandidate).trim() &&
      String(pcandidate).trim() !== "0"
    ) {
      return { value: String(pcandidate).trim(), source: "contract.profile" };
    }
  }

  return { value: String(customer.id), source: "customer.id (fallback)" };
}
