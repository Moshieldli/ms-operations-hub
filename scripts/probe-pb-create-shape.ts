/**
 * Find the correct POST /contacts body shape by trying variants and
 * fetching each created contact back to see which fields stuck.
 *
 * Run:
 *   PHONEBURNER_TOKEN=... node node_modules/tsx/dist/cli.mjs scripts/probe-pb-create-shape.ts
 */
const BASE = "https://www.phoneburner.com/rest/1";

function token(): string {
  const t = process.env.PHONEBURNER_TOKEN;
  if (!t) throw new Error("PHONEBURNER_TOKEN must be set");
  return t;
}

async function call(
  method: string,
  path: string,
  body?: BodyInit,
  contentType?: string
): Promise<{ status: number; bodyText: string; json: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
  };
  if (contentType) headers["Content-Type"] = contentType;
  const resp = await fetch(`${BASE}${path}`, { method, headers, body });
  const bodyText = await resp.text();
  let json: unknown = null;
  try {
    json = bodyText.length ? JSON.parse(bodyText) : null;
  } catch {
    /* ignore */
  }
  return { status: resp.status, bodyText, json };
}

function extractUserId(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const obj = json as Record<string, unknown>;
  // Walk: response.contacts.contacts.user_id (per Probe 2 finding)
  const inner1 = obj.contacts as Record<string, unknown> | undefined;
  if (inner1 && typeof inner1 === "object") {
    const inner2 = inner1.contacts as Record<string, unknown> | undefined;
    if (inner2 && typeof inner2 === "object" && inner2.user_id != null) {
      return String(inner2.user_id);
    }
    if (inner1.user_id != null) return String(inner1.user_id);
  }
  if (obj.user_id != null) return String(obj.user_id);
  return "";
}

interface Variant {
  name: string;
  build(): { body: BodyInit; contentType: string };
}

const TEST_PHONE_BASE = 5550100; // unique per variant so dedup doesn't collide

const variants: Variant[] = [
  {
    name: "v1: JSON, flat fields, raw_phone (current client)",
    build: () => ({
      body: JSON.stringify({
        first_name: "PROBE_V1",
        last_name: "DELETE_ME",
        raw_phone: "555" + (TEST_PHONE_BASE + 1),
        email_address: "v1@example.invalid",
        category_id: "3275950",
        notes: "v1 notes",
        custom_fields: [{ name: "Customer ID", type: 1, value: "PROBE-V1" }],
      }),
      contentType: "application/json",
    }),
  },
  {
    name: "v2: JSON, flat fields, phone instead of raw_phone",
    build: () => ({
      body: JSON.stringify({
        first_name: "PROBE_V2",
        last_name: "DELETE_ME",
        phone: "555" + (TEST_PHONE_BASE + 2),
        email_address: "v2@example.invalid",
        category_id: "3275950",
        notes: "v2 notes",
      }),
      contentType: "application/json",
    }),
  },
  {
    name: "v3: form-urlencoded, flat fields",
    build: () => {
      const p = new URLSearchParams();
      p.set("first_name", "PROBE_V3");
      p.set("last_name", "DELETE_ME");
      p.set("raw_phone", "555" + (TEST_PHONE_BASE + 3));
      p.set("email_address", "v3@example.invalid");
      p.set("category_id", "3275950");
      p.set("notes", "v3 notes");
      return { body: p.toString(), contentType: "application/x-www-form-urlencoded" };
    },
  },
  {
    name: "v4: form-urlencoded, phone (not raw_phone)",
    build: () => {
      const p = new URLSearchParams();
      p.set("first_name", "PROBE_V4");
      p.set("last_name", "DELETE_ME");
      p.set("phone", "555" + (TEST_PHONE_BASE + 4));
      p.set("email_address", "v4@example.invalid");
      p.set("category_id", "3275950");
      p.set("notes", "v4 notes");
      return { body: p.toString(), contentType: "application/x-www-form-urlencoded" };
    },
  },
];

(async () => {
  for (const v of variants) {
    console.log(`\n${"=".repeat(70)}\n${v.name}\n${"=".repeat(70)}`);
    const { body, contentType } = v.build();
    const created = await call("POST", "/contacts", body, contentType);
    console.log(`POST status: ${created.status}`);
    const userId = extractUserId(created.json);
    console.log(`extracted user_id: ${userId || "(none)"}`);

    if (!userId) {
      console.log(`response (truncated):`);
      console.log(created.bodyText.slice(0, 800));
      continue;
    }

    // Fetch the contact back to see what actually got stored.
    const fetched = await call("GET", `/contacts/${encodeURIComponent(userId)}`);
    console.log(`GET status: ${fetched.status}`);
    if (fetched.json && typeof fetched.json === "object") {
      // Walk to the contact object
      const obj = fetched.json as Record<string, unknown>;
      const inner1 = obj.contacts as Record<string, unknown> | undefined;
      const inner2 = inner1?.contacts as Record<string, unknown> | undefined;
      const c = inner2 ?? inner1 ?? obj;
      console.log(`stored fields:`);
      const interesting = ["user_id", "first_name", "last_name", "email_address", "phone", "raw_phone", "category_id", "category", "folder_id", "notes", "custom_fields"];
      for (const k of interesting) {
        const v = (c as Record<string, unknown>)[k];
        if (v == null) console.log(`  ${k.padEnd(15)} = (null)`);
        else if (typeof v === "object") console.log(`  ${k.padEnd(15)} = ${JSON.stringify(v).slice(0, 200)}`);
        else console.log(`  ${k.padEnd(15)} = ${String(v).slice(0, 100)}`);
      }
      // Also dump anything we haven't asked about so we don't miss the real folder field name
      const allKeys = Object.keys(c).filter((k) => !interesting.includes(k));
      if (allKeys.length) {
        console.log(`other keys: ${allKeys.join(", ")}`);
      }
    } else {
      console.log(`response (truncated):`);
      console.log(fetched.bodyText.slice(0, 800));
    }
  }

  console.log(`\n${"=".repeat(70)}\nGET /folders — list all folders, find Fresh\n${"=".repeat(70)}`);
  const folders = await call("GET", "/folders");
  console.log(`HTTP ${folders.status}`);
  console.log(folders.bodyText.slice(0, 2500));
})().catch((e) => {
  console.error("probe failed:", e);
  process.exitCode = 1;
});
