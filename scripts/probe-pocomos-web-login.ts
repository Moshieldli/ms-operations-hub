/**
 * Probe whether mstli.apiuser can log in through the web UI form
 * (POST /login) and obtain a PHPSESSID cookie that authorizes the
 * POST /leads/data DataTables endpoint — the endpoint that returns
 * the lead fields the JWT API doesn't (phone, email, date, etc.).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-pocomos-web-login.ts
 */
const BASE = "https://mypocomos.net";
const USERNAME = process.env.POCOMOS_USERNAME || "mstli.apiuser";
const PASSWORD = process.env.POCOMOS_PASSWORD || "mstli.apiuser";

function parseSetCookies(headers: Headers): Array<{ name: string; value: string; raw: string }> {
  // Headers.get only returns one Set-Cookie merged with commas — but cookies
  // can contain commas (e.g. Expires=Wed, 14 May...). Use getSetCookie() if
  // available (undici 5.20+, Node 20+), else fall back to the raw header.
  let raws: string[] = [];
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    raws = anyHeaders.getSetCookie();
  } else {
    const all = headers.get("set-cookie");
    if (all) raws = [all];
  }
  const out: Array<{ name: string; value: string; raw: string }> = [];
  for (const raw of raws) {
    const firstSemi = raw.indexOf(";");
    const pair = firstSemi === -1 ? raw : raw.slice(0, firstSemi);
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    out.push({
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      raw,
    });
  }
  return out;
}

function cookieJarToHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractInputValue(html: string, name: string): string | null {
  // Build a regex that finds <input ... name="<name>" ... value="..."> or
  // the reverse attribute order. Escape brackets for regex.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<input[^>]*name="${esc}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${esc}"`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

(async () => {
  const jar = new Map<string, string>();

  // 1. GET /login to discover form fields (CSRF token, action URL, etc.)
  console.log(`=== 1. GET ${BASE}/login (discover form) ===`);
  const loginPage = await fetch(`${BASE}/login`, {
    redirect: "manual",
    headers: { "User-Agent": "ms-operations-hub-probe/1.0" },
  });
  console.log(`status: ${loginPage.status}`);
  for (const c of parseSetCookies(loginPage.headers)) {
    jar.set(c.name, c.value);
    console.log(`  Set-Cookie: ${c.name} = ${c.value.slice(0, 12)}... (${c.raw.length} bytes)`);
  }
  const loginHtml = await loginPage.text();
  console.log(`html length: ${loginHtml.length}`);

  // Discover form action and all hidden input values.
  const formActionMatch = loginHtml.match(/<form[^>]*action="([^"]+)"[^>]*>/i);
  const formAction = formActionMatch ? formActionMatch[1] : "/login_submit";
  console.log(`form action: ${formAction}`);
  const inputNames = Array.from(loginHtml.matchAll(/<input[^>]*name="([^"]+)"/gi))
    .map((m) => m[1])
    .filter((n, i, a) => a.indexOf(n) === i);
  console.log(`form input names: ${inputNames.join(", ")}`);

  const formToken = extractInputValue(loginHtml, "form[_token]");
  const csrfToken = extractInputValue(loginHtml, "_csrf_token");
  console.log(
    `form[_token] = ${formToken ? formToken.slice(0, 16) + "..." : "(not found)"}`
  );
  console.log(
    `_csrf_token = ${csrfToken ? csrfToken.slice(0, 16) + "..." : "(not found)"}`
  );

  // 2. POST the discovered form action with the right field names
  const submitUrl = formAction.startsWith("http")
    ? formAction
    : new URL(formAction, BASE).toString();
  console.log(`\n=== 2. POST ${submitUrl} ===`);
  // Inspect the full input elements to see attribute hints (type, value, etc.)
  // so we can decide which fields to actually send.
  const inputBlocks = Array.from(
    loginHtml.matchAll(/<input[^>]*name="form\[[^"]+\]"[^>]*>/gi)
  ).map((m) => m[0]);
  console.log("Raw form[*] inputs:");
  for (const ib of inputBlocks) console.log("  " + ib);

  const body = new URLSearchParams();
  body.set("form[username]", USERNAME);
  body.set("form[password]", PASSWORD);
  if (formToken) body.set("form[_token]", formToken);
  // Try the minimal set first — omit rememberMe and email entirely.

  const postResp = await fetch(submitUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ms-operations-hub-probe/1.0",
      Accept: "text/html,application/xhtml+xml",
      Cookie: cookieJarToHeader(jar),
      Referer: `${BASE}/login`,
      Origin: BASE,
    },
    body: body.toString(),
  });
  console.log(`status: ${postResp.status}`);
  console.log(`location: ${postResp.headers.get("location") || "(none)"}`);
  const postCookies = parseSetCookies(postResp.headers);
  let gotNewPHPSESSID = false;
  for (const c of postCookies) {
    const prev = jar.get(c.name);
    jar.set(c.name, c.value);
    console.log(
      `  Set-Cookie: ${c.name} = ${c.value.slice(0, 12)}... (was: ${prev ? prev.slice(0, 12) + "..." : "n/a"})`
    );
    if (c.name === "PHPSESSID" && (!prev || prev !== c.value)) gotNewPHPSESSID = true;
  }
  const postBody = await postResp.text();
  console.log(`response body length: ${postBody.length}`);
  // Print the submit body so we can see error / redirect JSON.
  console.log(`response body: ${postBody.slice(0, 600)}`);

  // 3. Follow the redirect if any (login success usually 302s to /dashboard)
  let redirectStatus: number | null = null;
  if (
    postResp.status >= 300 &&
    postResp.status < 400 &&
    postResp.headers.get("location")
  ) {
    const loc = postResp.headers.get("location")!;
    const followUrl = loc.startsWith("http") ? loc : new URL(loc, BASE).toString();
    console.log(`\n=== 2b. Follow redirect to ${followUrl} ===`);
    const r2 = await fetch(followUrl, {
      redirect: "manual",
      headers: {
        Cookie: cookieJarToHeader(jar),
        "User-Agent": "ms-operations-hub-probe/1.0",
      },
    });
    redirectStatus = r2.status;
    console.log(`status: ${r2.status}`);
    console.log(`location: ${r2.headers.get("location") || "(none)"}`);
    for (const c of parseSetCookies(r2.headers)) {
      jar.set(c.name, c.value);
      console.log(`  Set-Cookie: ${c.name} = ${c.value.slice(0, 12)}...`);
    }
    const r2Body = await r2.text();
    console.log(`body length: ${r2Body.length}`);
    if (/Sign In|sign in|login form/i.test(r2Body) && r2Body.length < 50000) {
      console.log("Body looks like login page — auth likely failed.");
    }
  }

  console.log(`\nCookie jar after login: ${Array.from(jar.keys()).join(", ")}`);
  const hasPHPSESSID = jar.has("PHPSESSID");
  console.log(`PHPSESSID present: ${hasPHPSESSID}${gotNewPHPSESSID ? " (rotated by login — good sign)" : ""}`);

  if (!hasPHPSESSID) {
    console.log("\nNo PHPSESSID after login. Cannot test /leads/data. Aborting.");
    return;
  }

  // 4. POST /leads/data — DataTables format, filter to Lead status
  console.log(`\n=== 3. POST ${BASE}/leads/data (DataTables) ===`);
  const dtBody = new URLSearchParams();
  dtBody.set("draw", "1");
  dtBody.set("start", "0");
  dtBody.set("length", "10");
  dtBody.append("statuses[]", "Lead");
  // DataTables also typically includes search/order fields; include minimal.
  dtBody.set("search[value]", "");
  dtBody.set("search[regex]", "false");
  dtBody.set("order[0][column]", "0");
  dtBody.set("order[0][dir]", "desc");

  const dataResp = await fetch(`${BASE}/leads/data`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json,text/javascript,*/*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieJarToHeader(jar),
      Referer: `${BASE}/leads`,
      "User-Agent": "ms-operations-hub-probe/1.0",
    },
    body: dtBody.toString(),
  });
  console.log(`status: ${dataResp.status}`);
  console.log(`content-type: ${dataResp.headers.get("content-type")}`);
  const dataText = await dataResp.text();
  console.log(`body length: ${dataText.length}`);

  if (dataResp.status !== 200) {
    console.log(`first 600 chars of body:\n${dataText.slice(0, 600)}`);
    return;
  }

  let dataJson: unknown = null;
  try {
    dataJson = JSON.parse(dataText);
  } catch {
    console.log("Response is not JSON. First 800 chars:");
    console.log(dataText.slice(0, 800));
    return;
  }

  console.log(`response top-level keys: ${Object.keys(dataJson as Record<string, unknown>).join(", ")}`);
  const top = dataJson as Record<string, unknown>;
  // Pocomos uses legacy DataTables 1.9 keys: iTotalRecords / iTotalDisplayRecords / aaData.
  const total = top.iTotalRecords ?? top.recordsTotal;
  const filtered = top.iTotalDisplayRecords ?? top.recordsFiltered;
  const echo = top.sEcho ?? top.draw;
  console.log(`iTotalRecords=${total} iTotalDisplayRecords=${filtered} sEcho=${echo}`);
  const rows = (top.aaData ?? top.data) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("No rows returned. Full response (first 800 chars):");
    console.log(dataText.slice(0, 800));
    return;
  }

  console.log(`\nFirst lead — full field dump:`);
  const first = rows[0] as Record<string, unknown>;
  for (const [k, v] of Object.entries(first)) {
    if (v == null) {
      console.log(`  ${k} = null`);
    } else if (typeof v === "object") {
      console.log(`  ${k} = <${Array.isArray(v) ? `array(${(v as unknown[]).length})` : `object: ${Object.keys(v as Record<string, unknown>).join(", ")}`}>`);
    } else {
      const s = String(v);
      console.log(`  ${k} = ${s.length > 120 ? s.slice(0, 120) + "..." : s}`);
    }
  }

  // Highlight the fields we specifically need.
  console.log("\n*** Field hunt ***");
  const phoneKeys = Object.keys(first).filter((k) => /phone|cell|mobile|tel/i.test(k));
  const emailKeys = Object.keys(first).filter((k) => /email|mail/i.test(k));
  const dateKeys = Object.keys(first).filter((k) => /date|created|added|time/i.test(k));
  const tagKeys = Object.keys(first).filter((k) => /tag/i.test(k));
  const marketingKeys = Object.keys(first).filter((k) => /market|source|found.?by|referr|origin|campaign/i.test(k));
  console.log(`  phone-ish keys: ${phoneKeys.join(", ") || "(none)"}`);
  console.log(`  email-ish keys: ${emailKeys.join(", ") || "(none)"}`);
  console.log(`  date-ish keys:  ${dateKeys.join(", ") || "(none)"}`);
  console.log(`  tag-ish keys:   ${tagKeys.join(", ") || "(none)"}`);
  console.log(`  market-ish keys:${marketingKeys.join(", ") || "(none)"}`);

  console.log(`\nrows.length=${rows.length}, status=${redirectStatus ?? postResp.status}, PHPSESSID rotated=${gotNewPHPSESSID}`);
  console.log("\n=== Probe done ===");
})();
