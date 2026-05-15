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

/**
 * One HTTP call to the PhoneBurner REST v1 API.
 *
 * `body` may be:
 *   - undefined          → no request body
 *   - URLSearchParams    → application/x-www-form-urlencoded (PB REQUIRES this for /contacts writes)
 *   - any other object   → application/json (only used for the rare endpoint that accepts JSON)
 */
async function rawRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: URLSearchParams | unknown
): Promise<RawResponse> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
  };
  let serializedBody: string | undefined;
  if (body !== undefined) {
    if (body instanceof URLSearchParams) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      serializedBody = body.toString();
    } else {
      headers["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(body);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: serializedBody,
      signal: controller.signal,
      cache: "no-store",
    });
    const bodyText = await resp.text();
    let json: unknown = null;
    try {
      json = bodyText.length ? JSON.parse(bodyText) : null;
    } catch {
      json = null;
    }
    return { status: resp.status, body: bodyText, json };
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: URLSearchParams | unknown
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await gate();
    const resp = await rawRequest(method, path, body);
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
  /** Top-level phone (returned by GET; supplied via `phone` request key, NOT `raw_phone`). */
  raw_phone?: string;
  /** Returned at `primary_email.email_address` from GET. */
  email_address?: string;
  /** Returned inside `primary_address.address` etc. */
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Stored as `notes.notes` inside the GET response. PB prepends a date/author header. */
  notes?: string;
  website?: string;
  /** Returned as `category.category_id` from GET; supplied via `category_id` (also accepts `folder_id`). */
  category_id?: string;
  custom_fields?: Array<{ name: string; type?: number; value: string }>;
}

export interface PBFolder {
  folder_id: string;
  folder_name?: string;
  description?: string;
}

interface PBContactsListResponse {
  contacts?: {
    contacts?: PBContact[];
    total_results?: number;
    next_page?: string | null;
    page?: number;
    total_pages?: number;
  };
}

interface PBContactCreateResponse {
  contacts?: {
    /** PB returns this as a single object (not an array) for POST. */
    contacts?: Record<string, unknown>;
  };
}

interface PBContactSingleGetResponse {
  contacts?: {
    /** PB returns this as a single-element array for GET /contacts/{id}. */
    contacts?: Array<Record<string, unknown>>;
  };
}

interface PBFoldersResponse {
  folders?: Record<string, PBFolder>;
}

export interface CreateContactInput {
  first_name?: string;
  last_name?: string;
  /** PB request key is `phone`, NOT `raw_phone`. The 10-digit string. */
  phone?: string;
  /** PB request key is `email`, NOT `email_address`. */
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  /** Folder to drop the contact in. `category_id` and `folder_id` both work; using `category_id` for consistency with the request docs. */
  category_id: string;
  /**
   * Each entry must have name, value, type. PB serializes as
   * `custom_fields[i][name]=...`. NOTE: the `website` body field is
   * silently dropped by PB — to attach the Pocomos URL, add a
   * `{ name: "Pocomos Profile", type: 1, value: url }` entry here.
   */
  custom_fields?: Array<{ name: string; value: string; type?: number }>;
}

function buildCreateBody(input: CreateContactInput): URLSearchParams {
  const p = new URLSearchParams();
  if (input.first_name) p.set("first_name", input.first_name);
  if (input.last_name) p.set("last_name", input.last_name);
  if (input.phone) p.set("phone", input.phone);
  if (input.email) p.set("email", input.email);
  if (input.address1) p.set("address1", input.address1);
  if (input.city) p.set("city", input.city);
  if (input.state) p.set("state", input.state);
  if (input.zip) p.set("zip", input.zip);
  if (input.notes) p.set("notes", input.notes);
  p.set("category_id", input.category_id);
  if (input.custom_fields && input.custom_fields.length) {
    input.custom_fields.forEach((cf, i) => {
      p.set(`custom_fields[${i}][name]`, cf.name);
      p.set(`custom_fields[${i}][value]`, cf.value);
      p.set(`custom_fields[${i}][type]`, String(cf.type ?? 1));
    });
  }
  return p;
}

/** Normalize a row from a GET /contacts/{id} response into the public PBContact shape. */
function normalizeGetRow(row: Record<string, unknown>): PBContact {
  const primaryEmail = row.primary_email as { email_address?: string } | null | undefined;
  const primaryAddress = row.primary_address as
    | { address?: string; city?: string; state?: string; zip?: string }
    | null
    | undefined;
  const category = row.category as { category_id?: string } | null | undefined;
  const notesObj = row.notes as { notes?: string } | string | null | undefined;
  return {
    user_id: row.user_id != null ? String(row.user_id) : undefined,
    first_name: typeof row.first_name === "string" ? row.first_name : undefined,
    last_name: typeof row.last_name === "string" ? row.last_name : undefined,
    raw_phone: typeof row.raw_phone === "string" ? row.raw_phone : undefined,
    email_address: primaryEmail?.email_address,
    address1: primaryAddress?.address,
    city: primaryAddress?.city,
    state: primaryAddress?.state,
    zip: primaryAddress?.zip,
    category_id: category?.category_id,
    notes: typeof notesObj === "string" ? notesObj : notesObj?.notes,
    custom_fields: Array.isArray(row.custom_fields) ? (row.custom_fields as PBContact["custom_fields"]) : undefined,
  };
}

export async function createContact(input: CreateContactInput): Promise<PBContact> {
  const body = buildCreateBody(input);
  const resp = await request<PBContactCreateResponse>("POST", "/contacts", body);
  const inner = resp.contacts?.contacts;
  if (!inner || typeof inner !== "object") {
    throw new Error(`PhoneBurner create: unexpected response shape, no contacts.contacts`);
  }
  return {
    user_id: inner.user_id != null ? String(inner.user_id) : undefined,
    first_name: typeof inner.first_name === "string" ? inner.first_name : undefined,
    last_name: typeof inner.last_name === "string" ? inner.last_name : undefined,
  };
}

export async function getContact(userId: string): Promise<PBContact | null> {
  if (!userId) return null;
  try {
    const resp = await request<PBContactSingleGetResponse>(
      "GET",
      `/contacts/${encodeURIComponent(userId)}`
    );
    const arr = resp.contacts?.contacts;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return normalizeGetRow(arr[0]);
  } catch (e) {
    if (/failed: 404/.test((e as Error).message)) return null;
    throw e;
  }
}

/** Update a contact via PUT /contacts/{id}. Body fields use the same names as create. */
export async function updateContact(userId: string, input: Partial<CreateContactInput>): Promise<void> {
  if (!userId) throw new Error("updateContact requires a non-empty userId");
  // updateContact reuses the create body builder for any fields that overlap.
  const body = new URLSearchParams();
  if (input.first_name !== undefined) body.set("first_name", input.first_name);
  if (input.last_name !== undefined) body.set("last_name", input.last_name);
  if (input.phone !== undefined) body.set("phone", input.phone);
  if (input.email !== undefined) body.set("email", input.email);
  if (input.address1 !== undefined) body.set("address1", input.address1);
  if (input.city !== undefined) body.set("city", input.city);
  if (input.state !== undefined) body.set("state", input.state);
  if (input.zip !== undefined) body.set("zip", input.zip);
  if (input.notes !== undefined) body.set("notes", input.notes);
  if (input.category_id !== undefined) body.set("category_id", input.category_id);
  if (input.custom_fields) {
    input.custom_fields.forEach((cf, i) => {
      body.set(`custom_fields[${i}][name]`, cf.name);
      body.set(`custom_fields[${i}][value]`, cf.value);
      body.set(`custom_fields[${i}][type]`, String(cf.type ?? 1));
    });
  }
  await request<unknown>("PUT", `/contacts/${encodeURIComponent(userId)}`, body);
}

export async function deleteContact(userId: string): Promise<void> {
  if (!userId) throw new Error("deleteContact requires a non-empty userId");
  await request<unknown>("DELETE", `/contacts/${encodeURIComponent(userId)}`);
}

/**
 * Page through one folder's contacts. Yields rows in their PB GET shape.
 * Each page is one HTTP call.
 *
 * NOTE on the query parameter: PhoneBurner's `?folder_id=N` is silently
 * ignored — it returns every contact in the account regardless of folder.
 * The actually-filtering parameter is `?category_id=N`, even though the
 * folder list endpoint refers to these as `folder_id`. PB's inconsistency,
 * not ours. Discovered during the rev-4 deep probe (see docs/REFERENCE.md §4).
 */
export async function* listContactsInFolder(
  folderId: string | number,
  pageSize = 200
): AsyncGenerator<PBContact, void, unknown> {
  let page = 1;
  for (;;) {
    const resp = await request<PBContactsListResponse>(
      "GET",
      `/contacts?category_id=${encodeURIComponent(String(folderId))}&page=${page}&page_size=${pageSize}`
    );
    const inner = resp.contacts;
    const rows = inner?.contacts ?? [];
    for (const row of rows) yield normalizeGetRow(row as unknown as Record<string, unknown>);
    if (rows.length < pageSize) return;
    if (inner?.total_pages != null && page >= inner.total_pages) return;
    page += 1;
    if (page > 5000) return; // sanity cap
  }
}

export async function listAllContactsInFolder(
  folderId: string | number,
  pageSize = 200
): Promise<PBContact[]> {
  const out: PBContact[] = [];
  for await (const row of listContactsInFolder(folderId, pageSize)) out.push(row);
  return out;
}

export async function listFolders(): Promise<PBFolder[]> {
  const resp = await request<PBFoldersResponse>("GET", "/folders");
  const obj = resp.folders;
  if (!obj) return [];
  return Object.values(obj);
}

export async function getContactNotes(userId: string): Promise<string> {
  const c = await getContact(userId);
  return c?.notes ?? "";
}

export async function addContactNote(userId: string, note: string): Promise<void> {
  await updateContact(userId, { notes: note });
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
