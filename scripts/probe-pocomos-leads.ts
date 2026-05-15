/**
 * Phase 0 probe for the PhoneBurner sync.
 *
 * Confirms (before we build anything):
 *  a) Shape of GET /jwt/1512/lead/list?limit=5&offset=0 — pagination,
 *     status filter field, all top-level fields per lead.
 *  b) Shape of GET /jwt/1512/lead/{lead_id} — phone, date_created, email,
 *     marketing source / found_by_type names.
 *  c) Whether the tags endpoint accepts `?lead_id={id}` and returns tag
 *     data in the same shape as the contract-tags endpoint we already use.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-pocomos-leads.ts
 */
import { getJson, pocomosBase, pocomosOffice } from "../src/lib/pocomos";
import { getToken } from "../src/lib/pocomos";

function keys(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj as Record<string, unknown>);
}

function scalarSnapshot(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "object") continue;
    out[k] = String(v).slice(0, 80);
  }
  return out;
}

function shapeOfNested(obj: unknown, key: string): string {
  if (!obj || typeof obj !== "object") return "(none)";
  const v = (obj as Record<string, unknown>)[key];
  if (v == null) return "(null)";
  if (typeof v !== "object") return `${typeof v}: ${String(v).slice(0, 60)}`;
  if (Array.isArray(v)) return `array(${v.length})`;
  return `object: ${keys(v).join(", ")}`;
}

function findFieldsMatching(obj: unknown, regex: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (regex.test(k)) {
      out[k] =
        v == null
          ? "(null)"
          : typeof v === "object"
          ? Array.isArray(v)
            ? `array(${(v as unknown[]).length})`
            : `object: ${keys(v).join(", ")}`
          : `${typeof v}: ${String(v).slice(0, 80)}`;
    }
  }
  return out;
}

async function rawAuthedGet(path: string): Promise<{
  status: number;
  body: string;
  parsed: unknown;
}> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${pocomosBase()}${path}`;
  const resp = await fetch(url, {
    headers: { XauthToken: token, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await resp.text();
  let parsed: unknown = null;
  try {
    parsed = body.length ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  return { status: resp.status, body, parsed };
}

(async () => {
  const office = pocomosOffice();
  console.log(`Office: ${office}\n`);

  // ====== a) lead/list ======
  console.log("=== a) GET /jwt/" + office + "/lead/list?limit=5&offset=0 ===");
  const list = await getJson<{
    response?: unknown[];
    meta?: { total?: number; count?: number; limit?: number; offset?: number };
  }>(`/jwt/${office}/lead/list?limit=5&offset=0`);

  const responseField = list.response;
  const totalCount = Array.isArray(responseField) ? responseField.length : 0;
  console.log(`response.length: ${totalCount}`);
  console.log(`meta: ${JSON.stringify(list.meta)}\n`);

  if (!Array.isArray(responseField) || responseField.length === 0) {
    console.log("No leads in response — aborting probe.");
    return;
  }

  const leads = responseField as Array<Record<string, unknown>>;

  // Top-level union of keys across all 5
  const unionKeys = new Set<string>();
  for (const l of leads) for (const k of Object.keys(l)) unionKeys.add(k);
  console.log("Union of top-level keys across the 5 leads:");
  console.log("  " + Array.from(unionKeys).sort().join(", "));
  console.log("");

  // Print scalar fields of first lead
  console.log("First lead — scalar fields:");
  for (const [k, v] of Object.entries(scalarSnapshot(leads[0]))) {
    console.log(`  ${k} = ${v}`);
  }
  console.log("");

  // Print nested structure summary for first lead
  console.log("First lead — nested fields:");
  for (const k of Object.keys(leads[0])) {
    const v = leads[0][k];
    if (v && typeof v === "object") {
      console.log(`  ${k}: ${shapeOfNested(leads[0], k)}`);
    }
  }
  console.log("");

  // Status distribution across the 5
  console.log("Status values seen (looking for status.value === 'Lead'):");
  for (const l of leads) {
    const id = l.id;
    const status = l.status;
    if (status && typeof status === "object") {
      const sv = (status as Record<string, unknown>).value;
      console.log(`  id=${id} status.value=${JSON.stringify(sv)} status keys=${keys(status).join(",")}`);
    } else {
      console.log(`  id=${id} status=${JSON.stringify(status)}`);
    }
  }
  console.log("");

  // ====== b) lead detail ======
  // Pick first lead with status.value === 'Lead' (fall back to first)
  let targetLead =
    leads.find((l) => {
      const s = l.status as { value?: unknown } | undefined;
      return s && s.value === "Lead";
    }) || leads[0];
  const targetId = targetLead.id as string | number;
  console.log("=== b) GET /jwt/" + office + "/lead/" + targetId + " ===");

  const detailResp = await rawAuthedGet(`/jwt/${office}/lead/${targetId}`);
  console.log(`status: ${detailResp.status}`);

  let detail: Record<string, unknown> | null = null;
  if (
    detailResp.parsed &&
    typeof detailResp.parsed === "object" &&
    "response" in (detailResp.parsed as Record<string, unknown>)
  ) {
    const r = (detailResp.parsed as Record<string, unknown>).response;
    if (r && typeof r === "object" && !Array.isArray(r)) {
      detail = r as Record<string, unknown>;
    }
  }

  if (!detail) {
    console.log("detail response shape unexpected. Raw (first 600 chars):");
    console.log("  " + detailResp.body.slice(0, 600));
  } else {
    console.log("Top-level keys:");
    console.log("  " + Object.keys(detail).sort().join(", "));

    console.log("\nScalar fields:");
    for (const [k, v] of Object.entries(scalarSnapshot(detail))) {
      console.log(`  ${k} = ${v}`);
    }

    console.log("\nNested fields:");
    for (const k of Object.keys(detail)) {
      const v = detail[k];
      if (v && typeof v === "object") {
        console.log(`  ${k}: ${shapeOfNested(detail, k)}`);
      }
    }

    console.log("\n*** Phone-like fields ***");
    const phoneFields = findFieldsMatching(detail, /phone|cell|mobile|tel/i);
    if (Object.keys(phoneFields).length) {
      for (const [k, v] of Object.entries(phoneFields)) console.log(`  ${k}: ${v}`);
    } else {
      console.log("  (no top-level field matched /phone|cell|mobile|tel/)");
    }

    console.log("\n*** Date-like fields ***");
    const dateFields = findFieldsMatching(detail, /date|created|added|signed|time/i);
    if (Object.keys(dateFields).length) {
      for (const [k, v] of Object.entries(dateFields)) console.log(`  ${k}: ${v}`);
    } else {
      console.log("  (no top-level field matched /date|created|added|signed|time/)");
    }

    console.log("\n*** Email-like fields ***");
    const emailFields = findFieldsMatching(detail, /email|mail/i);
    if (Object.keys(emailFields).length) {
      for (const [k, v] of Object.entries(emailFields)) console.log(`  ${k}: ${v}`);
    } else {
      console.log("  (no top-level field matched /email|mail/)");
    }

    console.log("\n*** Marketing / source fields ***");
    const marketingFields = findFieldsMatching(
      detail,
      /market|source|found.?by|referr|lead.?type|origin|campaign/i
    );
    if (Object.keys(marketingFields).length) {
      for (const [k, v] of Object.entries(marketingFields)) console.log(`  ${k}: ${v}`);
    } else {
      console.log("  (no top-level field matched marketing-y terms)");
    }
  }

  // ====== c) tags endpoint with lead_id ======
  console.log("\n=== c) tags endpoint variants for lead_id=" + targetId + " ===");
  const tagPaths = [
    `/jwt/office/${office}/contract/0/tags?lead_id=${targetId}`,
    `/jwt/office/${office}/contract/-/tags?lead_id=${targetId}`,
    `/jwt/office/${office}/contract/${targetId}/tags?lead_id=${targetId}`,
    `/jwt/office/${office}/lead/${targetId}/tags`,
    `/jwt/${office}/lead/${targetId}/tags`,
  ];
  for (const p of tagPaths) {
    const resp = await rawAuthedGet(p);
    console.log(`  ${p}`);
    console.log(`    status: ${resp.status}`);
    if (resp.status === 200) {
      console.log(`    raw (first 400): ${resp.body.slice(0, 400)}`);
      if (
        resp.parsed &&
        typeof resp.parsed === "object" &&
        "response" in (resp.parsed as Record<string, unknown>)
      ) {
        const r = (resp.parsed as Record<string, unknown>).response;
        if (Array.isArray(r)) {
          console.log(`    response = array(${r.length})`);
          if (r.length) {
            console.log(`    first entry: ${JSON.stringify(r[0]).slice(0, 200)}`);
          }
        }
      }
    } else {
      console.log(`    body (first 200): ${resp.body.slice(0, 200)}`);
    }
  }

  // ====== d) pagination sanity ======
  console.log("\n=== d) Pagination behavior ===");
  const p2 = await getJson<{
    response?: unknown[];
    meta?: { total?: number; count?: number; limit?: number; offset?: number };
  }>(`/jwt/${office}/lead/list?limit=5&offset=5`);
  console.log(
    `page 2: response.length=${Array.isArray(p2.response) ? p2.response.length : "?"} meta=${JSON.stringify(p2.meta)}`
  );

  console.log("\n=== Probe done ===");
})();
