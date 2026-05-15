import { getSyncState, setSyncState } from "@/lib/db";

const BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";
const SESSION_KEY = "pocomos_session";
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const USER_AGENT = "ms-operations-hub-sync/1.0";

interface CachedSession {
  cookie: string;
  createdAt: string;
}

let inMemory: { cookie: string; createdAt: number } | null = null;
let inFlight: Promise<string> | null = null;

function creds(): { username: string; password: string } {
  const username = process.env.POCOMOS_WEB_USERNAME || process.env.POCOMOS_USERNAME;
  const password = process.env.POCOMOS_WEB_PASSWORD || process.env.POCOMOS_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "POCOMOS_WEB_USERNAME / POCOMOS_WEB_PASSWORD (or POCOMOS_USERNAME / POCOMOS_PASSWORD) must be set"
    );
  }
  return { username, password };
}

function parseSetCookies(headers: Headers): Array<{ name: string; value: string }> {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const raws =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : headers.get("set-cookie")
      ? [headers.get("set-cookie") as string]
      : [];
  const out: Array<{ name: string; value: string }> = [];
  for (const raw of raws) {
    const firstSemi = raw.indexOf(";");
    const pair = firstSemi === -1 ? raw : raw.slice(0, firstSemi);
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    out.push({ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() });
  }
  return out;
}

function jarToHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractFormToken(html: string): string | null {
  // Symfony renders <input type="hidden" name="form[_token]" value="..." />
  const re = /<input[^>]*name="form\[_token\]"[^>]*value="([^"]+)"|<input[^>]*value="([^"]+)"[^>]*name="form\[_token\]"/i;
  const m = html.match(re);
  return m ? (m[1] || m[2] || null) : null;
}

async function performLogin(): Promise<string> {
  const { username, password } = creds();
  const jar = new Map<string, string>();

  const loginPage = await fetch(`${BASE}/login`, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT },
  });
  for (const c of parseSetCookies(loginPage.headers)) jar.set(c.name, c.value);
  const html = await loginPage.text();
  const formToken = extractFormToken(html);
  if (!formToken) {
    throw new Error("Pocomos web login: form[_token] not found on /login page");
  }

  const body = new URLSearchParams();
  body.set("form[username]", username);
  body.set("form[password]", password);
  body.set("form[_token]", formToken);

  const submit = await fetch(`${BASE}/login_submit`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      Cookie: jarToHeader(jar),
      Referer: `${BASE}/login`,
      Origin: BASE,
    },
    body: body.toString(),
  });

  if (submit.status < 300 || submit.status >= 400) {
    const txt = await submit.text().catch(() => "");
    throw new Error(
      `Pocomos web login: expected 302 from /login_submit, got ${submit.status}: ${txt.slice(0, 200)}`
    );
  }
  for (const c of parseSetCookies(submit.headers)) jar.set(c.name, c.value);

  const phpsessid = jar.get("PHPSESSID");
  if (!phpsessid) {
    throw new Error("Pocomos web login: no PHPSESSID after /login_submit");
  }
  return `PHPSESSID=${phpsessid}`;
}

async function loadCachedCookie(): Promise<string | null> {
  if (inMemory && Date.now() - inMemory.createdAt < SESSION_IDLE_TTL_MS) {
    return inMemory.cookie;
  }
  const stored = await getSyncState<CachedSession>(SESSION_KEY);
  if (!stored) return null;
  const ageMs = Date.now() - new Date(stored.createdAt).getTime();
  if (ageMs >= SESSION_IDLE_TTL_MS) return null;
  inMemory = { cookie: stored.cookie, createdAt: Date.parse(stored.createdAt) };
  return stored.cookie;
}

async function persistCookie(cookie: string): Promise<void> {
  const createdAt = new Date().toISOString();
  inMemory = { cookie, createdAt: Date.parse(createdAt) };
  await setSyncState(SESSION_KEY, { cookie, createdAt } satisfies CachedSession);
}

/**
 * Returns a Cookie header value (`PHPSESSID=...`) authenticated against the
 * Pocomos web UI. Uses an in-memory cache backed by Neon `sync_state` so
 * concurrent serverless instances share the same session. Re-logs when the
 * cached session is older than the 30-minute idle TTL or when the caller
 * reports the session is dead via `invalidateSession()`.
 */
export async function getPocomosSession(): Promise<string> {
  const cached = await loadCachedCookie();
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const cookie = await performLogin();
      await persistCookie(cookie);
      return cookie;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Drop the cached session and force a fresh login on next call. */
export async function invalidateSession(): Promise<void> {
  inMemory = null;
  await setSyncState(SESSION_KEY, { cookie: "", createdAt: new Date(0).toISOString() });
}

/**
 * Detects the Pocomos session-expiry signal:
 *   {"type":"redirect","redirect":"/login"}
 * Some endpoints return 200 with this body instead of a 302; callers that
 * see this should invalidate and retry.
 */
export function looksLikeSessionExpired(body: string): boolean {
  if (!body || body.length > 200) return false;
  return /"type"\s*:\s*"redirect"/.test(body) && /"redirect"\s*:\s*"\/login"/.test(body);
}

/**
 * POST a form-encoded body to a session-cookie endpoint, automatically
 * re-logging once on session expiry. Returns the parsed JSON response.
 */
export async function postSessioned<T>(
  path: string,
  formBody: URLSearchParams,
  init?: { referer?: string }
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const referer = init?.referer ? `${BASE}${init.referer}` : `${BASE}/`;

  const doRequest = async (cookie: string) =>
    fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json,text/javascript,*/*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
        Referer: referer,
        "User-Agent": USER_AGENT,
      },
      body: formBody.toString(),
      cache: "no-store",
    });

  let cookie = await getPocomosSession();
  let resp = await doRequest(cookie);
  let text = await resp.text();

  const expired =
    (resp.status >= 300 && resp.status < 400 && (resp.headers.get("location") || "").includes("/login")) ||
    looksLikeSessionExpired(text);

  if (expired) {
    await invalidateSession();
    cookie = await getPocomosSession();
    resp = await doRequest(cookie);
    text = await resp.text();
  }

  if (!resp.ok) {
    throw new Error(`Pocomos web POST ${path} failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

/**
 * GET an HTML page using the session cookie (Surface C — HTML scrape).
 * Re-logs once on the same expiry signals as postSessioned.
 */
export async function getSessionedHtml(path: string): Promise<string> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;

  const doRequest = async (cookie: string) =>
    fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

  let cookie = await getPocomosSession();
  let resp = await doRequest(cookie);

  if (resp.status >= 300 && resp.status < 400 && (resp.headers.get("location") || "").includes("/login")) {
    await invalidateSession();
    cookie = await getPocomosSession();
    resp = await doRequest(cookie);
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Pocomos web GET ${path} failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  return text;
}

export function pocomosWebBase(): string {
  return BASE;
}
