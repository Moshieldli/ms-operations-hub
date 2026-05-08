/**
 * Second-pass probe: try more endpoints to find tags or customer_number.
 */
import { fetchAllCustomers, getJson, postJson, pocomosOffice } from "../src/lib/pocomos";

function summarize(label: string, body: unknown) {
  if (body == null) {
    console.log(`${label}: null/undefined`);
    return;
  }
  if (typeof body !== "object") {
    console.log(`${label}: ${typeof body}`);
    return;
  }
  console.log(`${label} keys: ${Object.keys(body as Record<string, unknown>).join(", ")}`);
}

async function tryGet(path: string, label: string) {
  try {
    const data = await getJson<{ response?: unknown; meta?: unknown }>(path);
    console.log(`✓ ${label} (${path})`);
    summarize("  body", data);
    if (data.response) {
      summarize("  response", data.response);
      if (Array.isArray(data.response)) {
        const arr = data.response as unknown[];
        console.log(`  response is array(${arr.length})`);
        if (arr.length) summarize("  response[0]", arr[0]);
      } else {
        const obj = data.response as Record<string, unknown>;
        const json = JSON.stringify(obj).slice(0, 600);
        console.log(`  response sample: ${json}`);
      }
    }
  } catch (e) {
    console.log(`✗ ${label} (${path}): ${(e as Error).message.slice(0, 200)}`);
  }
}

async function tryPost(path: string, payload: unknown, label: string) {
  try {
    const data = await postJson<{ response?: unknown }>(path, payload);
    console.log(`✓ ${label} (POST ${path})`);
    summarize("  body", data);
    if (data.response) {
      summarize("  response", data.response);
      console.log(`  sample: ${JSON.stringify(data.response).slice(0, 600)}`);
    }
  } catch (e) {
    console.log(`✗ ${label} (POST ${path}): ${(e as Error).message.slice(0, 200)}`);
  }
}

(async () => {
  const office = pocomosOffice();
  const all = await fetchAllCustomers();
  const active = all.filter(
    (c) => String(c.status || "").toLowerCase() === "active"
  );
  const sample = active[0];
  const id = sample.id;
  console.log(`Probing with active customer id=${id}\n`);

  // Customer detail variants
  await tryGet(`/jwt/pronexis/${office}/customer/${id}`, "customer detail [office]");
  await tryGet(`/jwt/pronexis/customer/${id}`, "customer detail [no office]");
  await tryGet(`/jwt/pronexis/customer/${id}/tags`, "customer/{id}/tags");
  await tryGet(`/jwt/pronexis/${office}/customer/${id}/tags`, "[office]/customer/{id}/tags");

  // Tag-related endpoints
  await tryGet(`/jwt/pronexis/${office}/tags`, "office/tags");
  await tryGet(`/jwt/pronexis/${office}/tag/list`, "tag/list");
  await tryGet(`/jwt/pronexis/${office}/tags/list`, "tags/list [office last]");
  await tryGet(`/jwt/pronexis/tags/${office}`, "tags/{office}");
  await tryGet(`/jwt/pronexis/${office}/customer/tags`, "customer/tags");
  await tryGet(`/jwt/pronexis/${office}/customer/tag/list`, "customer/tag/list");

  // Customer notes / data variants
  await tryGet(`/jwt/pronexis/${office}/customer/${id}/notes`, "customer/{id}/notes");
  await tryGet(`/jwt/pronexis/${office}/customer/${id}/profile`, "customer/{id}/profile");

  // Search variants
  await tryPost(`/jwt/pronexis/${office}/customer/search`, { active: true }, "search active=true");
  await tryPost(`/jwt/pronexis/${office}/customer/search`, { customer_id: id }, "search customer_id");
  await tryPost(`/jwt/pronexis/${office}/customer/search`, { id: String(id) }, "search id-as-string");

  // Pull a contract by ID (we saw contract id=1158866 earlier) and look for richer data
  const { fetchContractsForCustomers } = await import("../src/lib/pocomos");
  const { results } = await fetchContractsForCustomers([id]);
  const contracts = results.get(id) || [];
  if (contracts.length) {
    const cid = (contracts[0] as { id?: string | number }).id;
    if (cid) {
      await tryGet(`/jwt/pronexis/${office}/contract/${cid}`, "contract detail");
      await tryGet(`/jwt/pronexis/${office}/contract/${cid}/tags`, "contract/{id}/tags");
    }
  }
})();
