/**
 * Raw PB API probe — bypasses my client wrapper entirely so we see the
 * actual response shapes. Goals:
 *   1. POST a test contact, dump the full response
 *   2. GET the Fresh folder, dump what's actually inside
 *   3. Try several folder-list path variants — REFERENCE.md said
 *      /contacts/categories but that 404s; find the working path.
 *   4. Try GET /contacts/{some_id} to learn the single-contact response shape.
 *
 * Run:
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-pb-raw.ts
 */
const BASE = "https://www.phoneburner.com/rest/1";

function token(): string {
  const t = process.env.PHONEBURNER_TOKEN;
  if (!t) throw new Error("PHONEBURNER_TOKEN must be set");
  return t;
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; bodyText: string; json: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bodyText = await resp.text();
  let json: unknown = null;
  try {
    json = bodyText.length ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }
  return { status: resp.status, bodyText, json };
}

(async () => {
  console.log("=== Probe 1 — GET /contacts?category_id=3275950 (Fresh folder) ===\n");
  const fresh = await call("GET", "/contacts?category_id=3275950&page=1&page_size=20");
  console.log(`HTTP ${fresh.status}`);
  console.log(`response (first 1500 chars):`);
  console.log(fresh.bodyText.slice(0, 1500));
  console.log("");

  console.log("=== Probe 2 — POST /contacts (create a TEST contact) ===\n");
  const testPayload = {
    first_name: "DIAG_TEST",
    last_name: "DELETE_ME",
    raw_phone: "5555550199",
    email_address: "diag-test@example.invalid",
    category_id: "3275950",
    notes: "Diagnostic test contact — created by probe-pb-raw.ts. Safe to delete.",
    custom_fields: [{ name: "Customer ID", type: 1, value: "DIAG-TEST" }],
  };
  const created = await call("POST", "/contacts", testPayload);
  console.log(`HTTP ${created.status}`);
  console.log(`response (full):`);
  console.log(created.bodyText.slice(0, 2000));
  console.log("");

  // Save the user_id (if we can find it) for the next probe
  let createdUserId = "";
  if (created.json && typeof created.json === "object") {
    const obj = created.json as Record<string, unknown>;
    const inner = (obj.contact ?? obj) as Record<string, unknown>;
    if (inner.user_id != null) createdUserId = String(inner.user_id);
    if (!createdUserId && obj.user_id != null) createdUserId = String(obj.user_id);
    // Sometimes responses use `id` not `user_id`
    if (!createdUserId && (inner as { id?: unknown }).id != null) createdUserId = String((inner as { id: unknown }).id);
  }
  console.log(`extracted user_id: ${createdUserId || "(NOT FOUND in response)"}\n`);

  console.log("=== Probe 3 — GET /contacts/{just_created_id} ===\n");
  if (createdUserId) {
    const single = await call("GET", `/contacts/${encodeURIComponent(createdUserId)}`);
    console.log(`HTTP ${single.status}`);
    console.log(`response (full):`);
    console.log(single.bodyText.slice(0, 2000));
  } else {
    console.log("(skipped — no user_id from create response)");
  }
  console.log("");

  console.log("=== Probe 4 — find the working folder-list endpoint ===\n");
  const candidates = [
    "/contacts/categories",
    "/contacts/folders",
    "/contact_categories",
    "/folders",
    "/categories",
    "/contacts/category",
    "/contact-categories",
  ];
  for (const path of candidates) {
    const r = await call("GET", path);
    console.log(`  ${path.padEnd(28)} → HTTP ${r.status}  ${r.bodyText.slice(0, 100).replace(/\n/g, " ")}`);
  }

  console.log("\n=== Probe 5 — re-fetch Fresh folder after the create (looking for the test contact) ===\n");
  const freshAfter = await call("GET", "/contacts?category_id=3275950&page=1&page_size=20");
  console.log(`HTTP ${freshAfter.status}`);
  if (freshAfter.json && typeof freshAfter.json === "object") {
    // Try to count rows
    const obj = freshAfter.json as Record<string, unknown>;
    const inner = (obj.contacts ?? obj) as Record<string, unknown>;
    const rows = (inner.contacts ?? (Array.isArray(inner) ? inner : null)) as unknown[] | null;
    console.log(`top-level keys: ${Object.keys(obj).join(", ")}`);
    if (Array.isArray(rows)) {
      console.log(`rows in this page: ${rows.length}`);
      if (rows.length) {
        console.log(`first row:`);
        console.log(JSON.stringify(rows[0], null, 2).slice(0, 1500));
      }
    } else {
      console.log("response shape doesn't match {contacts:{contacts:[...]}}");
      console.log(freshAfter.bodyText.slice(0, 1000));
    }
  } else {
    console.log(freshAfter.bodyText.slice(0, 800));
  }

  console.log("\n=== done ===");
})().catch((e) => {
  console.error("probe failed:", e);
  process.exitCode = 1;
});
