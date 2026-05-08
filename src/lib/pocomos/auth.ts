const TOKEN_TTL_MS = 50 * 60 * 1000;

interface TokenCache {
  token: string;
  fetchedAt: number;
}

let cache: TokenCache | null = null;
let inFlight: Promise<string> | null = null;

function config() {
  const username = process.env.POCOMOS_USERNAME;
  const password = process.env.POCOMOS_PASSWORD;
  const base = process.env.POCOMOS_BASE || "https://mypocomos.net";
  if (!username || !password) {
    throw new Error(
      "POCOMOS_USERNAME / POCOMOS_PASSWORD must be set in environment"
    );
  }
  return { username, password, base };
}

async function fetchToken(): Promise<string> {
  const { username, password, base } = config();
  const body = new URLSearchParams({ username, password }).toString();
  const resp = await fetch(`${base}/public/technician/jwt_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Pocomos auth failed: HTTP ${resp.status} ${text.slice(0, 200)}`
    );
  }
  const json = (await resp.json()) as {
    response?: string;
    token?: string;
    jwt?: string;
  };
  const token = json.response || json.token || json.jwt;
  if (!token) throw new Error("Pocomos auth: no token in response");
  return token;
}

export async function getToken(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < TOKEN_TTL_MS) {
    return cache.token;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const token = await fetchToken();
      cache = { token, fetchedAt: Date.now() };
      return token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function clearTokenCache() {
  cache = null;
}
