const BASE = "https://www.phoneburner.com/rest/1";
const INTER_CALL_PAUSE_MS = 200;
const MAX_CONCURRENT = 5;
const RETRY_DELAYS_MS = [1500, 4000, 10000];
const PER_REQUEST_TIMEOUT_MS = 20000;

function token(): string {
  const t = process.env.PHONEBURNER_TOKEN;
  if (!t) throw new Error("PHONEBURNER_TOKEN must be set");
  return t;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let lastCallAt = 0;
async function gate() {
  const since = Date.now() - lastCallAt;
  if (since < INTER_CALL_PAUSE_MS) {
    await sleep(INTER_CALL_PAUSE_MS - since);
  }
  lastCallAt = Date.now();
}

interface RawResponse {
  status: number;
  body: string;
  json: unknown;
}

async function rawRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  jsonBody?: unknown
): Promise<RawResponse> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
  };
  if (jsonBody !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await resp.text();
    let json: unknown = null;
    try {
      json = body.length ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    return { status: resp.status, body, json };
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  jsonBody?: unknown
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await gate();
    const resp = await rawRequest(method, path, jsonBody);
    if (resp.status >= 200 && resp.status < 300) {
      return resp.json as T;
    }
    if (resp.status === 429 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if ((resp.status === 502 || resp.status === 503 || resp.status === 504) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(
      `PhoneBurner ${method} ${path} failed: ${resp.status} ${resp.body.slice(0, 200)}`
    );
  }
}

export interface PBContact {
  user_id?: string;
  first_name?: string;
  last_name?: string;
  raw_phone?: string;
  email_address?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  website?: string;
  category_id?: string | number;
  custom_fields?: Array<{ name: string; type?: number; value: string }>;
}

export interface PBFolder {
  category_id: string;
  category_name?: string;
  name?: string;
}

export interface PBContactsListResponse {
  contacts?: {
    contacts?: PBContact[];
    total_results?: number;
    next_page?: string | null;
  };
}

export async function createContact(payload: PBContact): Promise<PBContact> {
  const resp = await request<{ contact?: PBContact } & PBContact>("POST", "/contacts", payload);
  return (resp.contact ?? resp) as PBContact;
}

export async function updateContact(userId: string, patch: PBContact): Promise<PBContact> {
  const resp = await request<{ contact?: PBContact } & PBContact>(
    "PUT",
    `/contacts/${encodeURIComponent(userId)}`,
    patch
  );
  return (resp.contact ?? resp) as PBContact;
}

export async function getContact(userId: string): Promise<PBContact | null> {
  try {
    const resp = await request<{ contact?: PBContact } & PBContact>(
      "GET",
      `/contacts/${encodeURIComponent(userId)}`
    );
    return (resp.contact ?? resp) as PBContact;
  } catch (e) {
    if (/failed: 404/.test((e as Error).message)) return null;
    throw e;
  }
}

/**
 * Page through one folder's contacts. Yields raw `PBContact` rows. Each page
 * is one HTTP call; the gate() in `request` handles the 200ms pause.
 */
export async function* listContactsInFolder(
  categoryId: string | number,
  pageSize = 500
): AsyncGenerator<PBContact, void, unknown> {
  let page = 1;
  for (;;) {
    const resp = await request<PBContactsListResponse>(
      "GET",
      `/contacts?category_id=${encodeURIComponent(String(categoryId))}&page=${page}&page_size=${pageSize}`
    );
    const inner = resp.contacts;
    const rows = inner?.contacts ?? [];
    for (const row of rows) yield row;
    if (rows.length < pageSize || !inner?.next_page) return;
    page += 1;
    if (page > 1000) return; // sanity guard
  }
}

/**
 * Materialized version of listContactsInFolder for callers that want an
 * array. Fine on folders up to a few thousand; for big folders prefer the
 * generator above.
 */
export async function listAllContactsInFolder(
  categoryId: string | number,
  pageSize = 500
): Promise<PBContact[]> {
  const out: PBContact[] = [];
  for await (const row of listContactsInFolder(categoryId, pageSize)) out.push(row);
  return out;
}

export async function listFolders(): Promise<PBFolder[]> {
  const resp = await request<{ categories?: PBFolder[] } & { categories?: { categories?: PBFolder[] } }>(
    "GET",
    "/contacts/categories"
  );
  // PB shape: { categories: [...] } sometimes wrapped.
  const inner = resp.categories;
  if (Array.isArray(inner)) return inner;
  if (inner && Array.isArray((inner as { categories?: PBFolder[] }).categories)) {
    return (inner as { categories: PBFolder[] }).categories;
  }
  return [];
}

export async function getContactNotes(userId: string): Promise<string> {
  const c = await getContact(userId);
  return c?.notes ?? "";
}

export async function addContactNote(userId: string, note: string): Promise<void> {
  // PhoneBurner stores notes as a single text field on the contact, so an
  // "add" is really "fetch existing + prepend + update". Newest first.
  const existing = await getContactNotes(userId);
  const next = existing ? `${note}\n\n${existing}` : note;
  await updateContact(userId, { notes: next });
}

/**
 * Run the same async work for many keys, capping concurrency at MAX_CONCURRENT.
 * Errors per key are caught and surfaced in the result; the rest of the batch
 * continues. Used by leadSync / conversionCleanup so one bad row doesn't tank
 * the whole pass.
 */
export async function runBatched<K, V>(
  keys: K[],
  worker: (key: K) => Promise<V>
): Promise<Array<{ key: K; value?: V; error?: string }>> {
  const out: Array<{ key: K; value?: V; error?: string }> = new Array(keys.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const launch = async () => {
    while (cursor < keys.length) {
      const idx = cursor++;
      try {
        out[idx] = { key: keys[idx], value: await worker(keys[idx]) };
      } catch (e) {
        out[idx] = { key: keys[idx], error: (e as Error).message };
      }
    }
  };
  const slots = Math.min(MAX_CONCURRENT, keys.length);
  for (let i = 0; i < slots; i++) workers.push(launch());
  await Promise.all(workers);
  return out;
}

/** Strip a phone string down to its trailing 10 digits (US numbers). */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length > 10 ? digits.slice(-10) : digits;
}
