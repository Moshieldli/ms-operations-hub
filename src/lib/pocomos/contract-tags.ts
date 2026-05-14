import { getToken } from "./auth";
import { pocomosBase, pocomosOffice } from "./client";
import { fetchPooled, isTransientStatus, TransientError } from "./pool";

interface TagsResponse {
  response?: Array<{
    id?: number | string;
    name?: string;
    active?: boolean;
    description?: string;
    customer_visible?: boolean;
    selected_by_default?: boolean;
  }>;
}

function buildPath(pestContractId: string | number) {
  return `/jwt/office/${pocomosOffice()}/contract/${pestContractId}/tags`;
}

async function fetchOne(pestContractId: string | number): Promise<string[]> {
  const token = await getToken();
  const url = `${pocomosBase()}${buildPath(pestContractId)}`;
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
        `tags ${pestContractId}: HTTP ${resp.status} ${body.slice(0, 120)}`
      );
    }
    // Non-retryable (e.g., 400 "Unable to locate Contract" for stale ids).
    return [];
  }
  let parsed: TagsResponse;
  try {
    parsed = JSON.parse(body) as TagsResponse;
  } catch {
    return [];
  }
  const list = parsed.response;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const t of list) {
    const name = String(t?.name || "").trim();
    if (name) out.push(name);
  }
  return out;
}

export async function fetchTagsForPestContracts(
  pestContractIds: Array<string | number>
) {
  return fetchPooled(pestContractIds, fetchOne, { concurrency: 5 });
}
