import { getToken } from "./auth";
import { pocomosBase, pocomosOffice } from "./client";
import { fetchPooled, isTransientStatus, TransientError } from "./pool";
import type { PocomosContract } from "./types";

interface ContractsResponse {
  response?: PocomosContract[];
}

function buildPath(customerId: string | number) {
  return `/jwt/pronexis/${pocomosOffice()}/customer/${customerId}/contracts`;
}

async function fetchOne(customerId: string | number): Promise<PocomosContract[]> {
  const token = await getToken();
  const url = `${pocomosBase()}${buildPath(customerId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { XauthToken: token, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
  const body = await resp.text();
  if (!resp.ok) {
    if (isTransientStatus(resp.status, body)) {
      throw new TransientError(
        `contracts ${customerId}: HTTP ${resp.status} ${body.slice(0, 120)}`
      );
    }
    return [];
  }
  try {
    const parsed = JSON.parse(body) as ContractsResponse;
    return Array.isArray(parsed.response) ? parsed.response : [];
  } catch {
    return [];
  }
}

export async function fetchContractsForCustomers(
  customerIds: Array<string | number>
) {
  return fetchPooled(customerIds, fetchOne, { concurrency: 5 });
}
