/**
 * Third-pass probe: dump tag names and look for tag-to-customer linkage.
 */
import { fetchAllCustomers, getJson, postJson, pocomosOffice } from "../src/lib/pocomos";

async function tryGet(path: string, label: string) {
  try {
    const data = await getJson<{ response?: unknown }>(path);
    const r = data.response;
    let summary = "(null)";
    if (Array.isArray(r)) summary = `array(${r.length})`;
    else if (r && typeof r === "object") summary = Object.keys(r as Record<string, unknown>).join(",");
    console.log(`✓ ${label} -> ${summary}`);
    if (Array.isArray(r) && r.length) {
      console.log(`  first: ${JSON.stringify(r[0]).slice(0, 300)}`);
    }
    return data;
  } catch (e) {
    console.log(`✗ ${label}: ${(e as Error).message.slice(0, 150)}`);
    return null;
  }
}

async function tryPost(path: string, payload: unknown, label: string) {
  try {
    const data = await postJson<{ response?: unknown }>(path, payload);
    const r = data.response;
    let summary = "(null)";
    if (Array.isArray(r)) summary = `array(${r.length})`;
    else if (r && typeof r === "object") summary = Object.keys(r as Record<string, unknown>).join(",");
    console.log(`✓ ${label} -> ${summary}`);
    if (Array.isArray(r) && r.length) {
      console.log(`  first: ${JSON.stringify(r[0]).slice(0, 300)}`);
    }
    return data;
  } catch (e) {
    console.log(`✗ ${label}: ${(e as Error).message.slice(0, 150)}`);
    return null;
  }
}

(async () => {
  const office = pocomosOffice();

  console.log("=== Tag dictionary ===");
  const tagsResp = await getJson<{ response?: Array<{ id: number; name: string; description?: string }> }>(
    `/jwt/pronexis/${office}/tags`
  );
  const tags = tagsResp.response || [];
  console.log(`${tags.length} tag definitions:`);
  for (const t of tags) {
    console.log(`  id=${t.id}  ${t.name}${t.description ? "  // " + t.description : ""}`);
  }

  // Find a year-named tag (e.g., "2026 - New Sale") to use for testing linkage probes
  const newSaleTag = tags.find((t) => /\d{4} - New Sale/i.test(t.name));
  const sampleTag = newSaleTag || tags[0];
  console.log(`\nProbe tag: id=${sampleTag.id} name="${sampleTag.name}"\n`);

  // Get a sample active customer
  const all = await fetchAllCustomers();
  const active = all.filter((c) => String(c.status || "").toLowerCase() === "active");
  const sample = active[0];
  const cid = sample.id;

  console.log("=== Tag-to-customer linkage probes ===");
  // GET patterns
  await tryGet(`/jwt/pronexis/${office}/tag/${sampleTag.id}`, "tag detail");
  await tryGet(`/jwt/pronexis/${office}/tag/${sampleTag.id}/customers`, "tag/{id}/customers");
  await tryGet(`/jwt/pronexis/${office}/customers/by-tag/${sampleTag.id}`, "customers/by-tag/{id}");
  await tryGet(`/jwt/pronexis/${office}/customer/list/by-tag/${sampleTag.id}`, "customer/list/by-tag/{id}");
  await tryGet(`/jwt/pronexis/${office}/customer/${cid}/tag/list`, "customer/{id}/tag/list");
  await tryGet(`/jwt/pronexis/${office}/customer/${cid}/tag`, "customer/{id}/tag");

  // POST patterns
  await tryPost(`/jwt/pronexis/${office}/customer/list`, { tag: sampleTag.id }, "customer/list POST tag-filter");
  await tryPost(`/jwt/pronexis/${office}/customer/list`, { tags: [sampleTag.id] }, "customer/list POST tags-array");
  await tryPost(`/jwt/pronexis/${office}/customer/search`, {}, "search empty body");

  // What about GET on customer list with extras query?
  await tryGet(`/jwt/pronexis/customer/list/${office}?include=tags`, "customer list ?include=tags");
  await tryGet(`/jwt/pronexis/customer/list/${office}?with=tags`, "customer list ?with=tags");

  // Try contract detail with the actual contract id (correct office in path)
  const { fetchContractsForCustomers } = await import("../src/lib/pocomos");
  const { results } = await fetchContractsForCustomers([cid]);
  const contracts = results.get(cid) || [];
  if (contracts.length) {
    const c0 = contracts[0] as { id?: number };
    if (c0.id) {
      await tryGet(`/jwt/pronexis/${office}/contract/${c0.id}/tag/list`, "contract/{id}/tag/list");
      await tryGet(`/jwt/pronexis/${office}/contract/${c0.id}/tags`, "contract/{id}/tags v2");
    }
  }
})();
