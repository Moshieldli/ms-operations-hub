import { fetchBatched, pocomosOffice } from "./client";
import type { PocomosContract } from "./types";

interface ContractsResponse {
  response?: PocomosContract[];
}

function buildPath(customerId: string | number) {
  return `/jwt/pronexis/${pocomosOffice()}/customer/${customerId}/contracts`;
}

function parse(_key: string | number, body: unknown): PocomosContract[] {
  if (!body || typeof body !== "object") return [];
  const r = (body as ContractsResponse).response;
  return Array.isArray(r) ? r : [];
}

export async function fetchContractsForCustomers(
  customerIds: Array<string | number>
) {
  return fetchBatched(customerIds, buildPath, parse);
}
