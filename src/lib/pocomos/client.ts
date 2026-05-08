import { getToken } from "./auth";

const DEFAULTS = {
  base: process.env.POCOMOS_BASE || "https://mypocomos.net",
  office: process.env.POCOMOS_OFFICE || "1512",
  maxConcurrent: 5,
  batchPauseMs: 1200,
  retryDelaysMs: [1500, 4000, 10000],
  perRequestTimeoutMs: 30000,
};

export function pocomosBase() {
  return DEFAULTS.base;
}

export function pocomosOffice() {
  return DEFAULTS.office;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${DEFAULTS.base}${path}`;
  const headers: Record<string, string> = {
    XauthToken: token,
    Accept: "application/json",
  };
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      headers[k] = v;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    DEFAULTS.perRequestTimeoutMs
  );
  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const resp = await authedFetch(path);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Pocomos GET ${path} failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const resp = await authedFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Pocomos POST ${path} failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

const RATE_LIMIT_PATTERN = /bandwidth|rate.?limit|quota/i;

function isRetryable(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    RATE_LIMIT_PATTERN.test(body)
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BatchResult<K, V> {
  results: Map<K, V>;
  failures: K[];
}

export async function fetchBatched<K, V>(
  keys: K[],
  buildPath: (key: K) => string,
  parseResponse: (key: K, body: unknown) => V
): Promise<BatchResult<K, V>> {
  const results = new Map<K, V>();
  const failures: K[] = [];

  for (let i = 0; i < keys.length; i += DEFAULTS.maxConcurrent) {
    const batch = keys.slice(i, i + DEFAULTS.maxConcurrent);
    let pending = batch.slice();

    for (
      let attempt = 0;
      attempt <= DEFAULTS.retryDelaysMs.length && pending.length;
      attempt++
    ) {
      if (attempt > 0) {
        await sleep(DEFAULTS.retryDelaysMs[attempt - 1]);
      }

      const settled = await Promise.allSettled(
        pending.map(async (key) => {
          const resp = await authedFetch(buildPath(key));
          const body = await resp.text();
          return { key, status: resp.status, body };
        })
      );

      const stillPending: K[] = [];
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          // Network/abort error — retry the whole batch up to retry budget.
          // We don't know which key threw without per-key tracking; keep pending.
          continue;
        }
        const { key, status, body } = outcome.value;
        if (status >= 200 && status < 300) {
          let parsed: unknown = null;
          try {
            parsed = body.length ? JSON.parse(body) : null;
          } catch {
            parsed = null;
          }
          try {
            results.set(key, parseResponse(key, parsed));
          } catch {
            results.set(key, parseResponse(key, null));
          }
        } else if (isRetryable(status, body)) {
          stillPending.push(key);
        } else {
          // Non-retryable error; record as empty/null result via parser
          results.set(key, parseResponse(key, null));
        }
      }
      // If Promise.allSettled rejected some, those keys won't appear above.
      // Re-pend any keys that have neither been resolved nor explicitly retried.
      for (const key of pending) {
        if (!results.has(key) && !stillPending.includes(key)) {
          stillPending.push(key);
        }
      }
      pending = stillPending;
    }

    for (const key of pending) {
      results.set(key, parseResponse(key, null));
      failures.push(key);
    }

    if (i + DEFAULTS.maxConcurrent < keys.length) {
      await sleep(DEFAULTS.batchPauseMs);
    }
  }

  return { results, failures };
}
