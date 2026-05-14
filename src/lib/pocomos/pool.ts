/**
 * Rolling-concurrency request pool. Unlike `fetchBatched` (which waits for a
 * whole batch of N to finish, then pauses 1.2s before the next batch), this
 * keeps exactly `concurrency` requests in flight at all times. For the sales
 * provider we issue thousands of calls; batched-with-pause adds ~10x latency
 * that we can't absorb inside a Vercel function timeout.
 *
 * The Pocomos rate limit is "5 concurrent" — this respects that hard cap.
 * On 429 / 5xx / bandwidth-quota responses we back off and retry per key.
 */
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_PATTERN = /bandwidth|rate.?limit|quota/i;

export interface PoolOptions {
  concurrency?: number;
  retryDelaysMs?: number[];
}

export interface PoolResult<K, V> {
  results: Map<K, V>;
  failures: K[];
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

export function isTransientStatus(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    RATE_LIMIT_PATTERN.test(body)
  );
}

export async function fetchPooled<K, V>(
  keys: K[],
  fetchOne: (key: K) => Promise<V>,
  options: PoolOptions = {}
): Promise<PoolResult<K, V>> {
  const concurrency = options.concurrency ?? 5;
  const retries = options.retryDelaysMs ?? [1500, 4000, 10000];

  const results = new Map<K, V>();
  const failures: K[] = [];
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= keys.length) return;
      const key = keys[idx];

      let attempt = 0;
      while (true) {
        try {
          const v = await fetchOne(key);
          results.set(key, v);
          break;
        } catch (e) {
          const transient =
            e instanceof TransientError ||
            (e instanceof Error && /\b429\b|\b50[234]\b|bandwidth|quota|abort/i.test(e.message));
          if (!transient || attempt >= retries.length) {
            failures.push(key);
            break;
          }
          await sleep(retries[attempt]);
          attempt++;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, keys.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return { results, failures };
}
