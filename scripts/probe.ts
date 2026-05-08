/**
 * Pocomos API probe — hits the API live and dumps the shape of customer
 * and contract objects so we can confirm where customer_number and tags
 * actually live. Run via:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe.ts
 */
import {
  fetchActiveCustomers,
  fetchAllCustomers,
  fetchContractsForCustomers,
  fetchOfficeTagMap,
  resolveCustomerNumber,
  tagsForContract,
  tagsForCustomer,
} from "../src/lib/pocomos";

function summarizeKeys(obj: unknown, depth = 0): string {
  if (obj == null || typeof obj !== "object") return typeof obj;
  return Object.keys(obj as Record<string, unknown>).join(", ");
}

function scalarSnapshot(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "object") continue;
    out[k] = String(v).slice(0, 60);
  }
  return out;
}

(async () => {
  console.log("=== Probe: customer list ===");
  const all = await fetchAllCustomers();
  console.log(`Total customers (all statuses): ${all.length}`);
  const active = all.filter(
    (c) => String(c.status || "").toLowerCase() === "active"
  );
  console.log(`Active customers: ${active.length}`);

  if (!all.length) {
    console.log("No customers returned. Aborting.");
    return;
  }

  const sample = active[0] || all[0];
  console.log("\n--- Sample customer keys ---");
  console.log(summarizeKeys(sample));
  console.log("--- Sample customer scalars ---");
  console.log(scalarSnapshot(sample));

  console.log("\n--- Customer.tags inspection ---");
  console.log("typeof tags:", typeof sample.tags, Array.isArray(sample.tags));
  if (sample.tags && Array.isArray(sample.tags) && sample.tags.length) {
    console.log("first 3 tag entries:", JSON.stringify(sample.tags.slice(0, 3)));
  } else {
    console.log("no tags array on customer object");
  }

  console.log("\n=== Probe: office tag dictionary ===");
  let tagMap = new Map<string | number, string>();
  try {
    tagMap = await fetchOfficeTagMap();
    console.log(`Office tags: ${tagMap.size}`);
    const sampleTags = Array.from(tagMap.entries()).slice(0, 8);
    console.log("Sample (id -> name):");
    for (const [id, name] of sampleTags) console.log(`  ${id} -> ${name}`);
  } catch (e) {
    console.log("Tags endpoint failed:", (e as Error).message);
  }

  console.log("\n=== Probe: contracts for first 3 active customers ===");
  const probeIds = active.slice(0, 3).map((c) => c.id);
  const t0 = Date.now();
  const { results: contractsMap, failures } = await fetchContractsForCustomers(
    probeIds
  );
  console.log(`Fetched ${contractsMap.size} contract sets in ${Date.now() - t0}ms`);
  console.log(`Failures: ${failures.length}`);

  for (const id of probeIds) {
    const contracts = contractsMap.get(id) || [];
    console.log(`\n--- customer.id=${id} -> ${contracts.length} contract(s) ---`);
    if (!contracts.length) continue;
    const c0 = contracts[0];
    console.log("contract keys:", summarizeKeys(c0));
    console.log("contract.profile keys:", summarizeKeys(c0.profile));
    console.log("contract.profile scalars:", scalarSnapshot(c0.profile));
    console.log(
      "contract.pest_contract keys:",
      summarizeKeys(c0.pest_contract)
    );
    const customer = active.find((c) => c.id === id)!;
    const { value, source } = resolveCustomerNumber(customer, contracts);
    console.log(`resolveCustomerNumber: ${value} (source: ${source})`);
    const customerTagSet = tagsForCustomer(customer, tagMap);
    const contractTags = tagsForContract(c0, tagMap);
    console.log(
      `tags: customer=${customerTagSet.size} contract=${contractTags.length}`
    );
    if (customerTagSet.size) {
      console.log("  customer tags sample:", Array.from(customerTagSet).slice(0, 5));
    }
    if (contractTags.length) {
      console.log("  contract tags sample:", contractTags.slice(0, 5));
    }
  }

  console.log("\n=== Probe: customer search endpoint (POST) ===");
  // Only try if customer.id is the only candidate so we know we need the search
  try {
    const { postJson, pocomosOffice } = await import("../src/lib/pocomos/client");
    const search = await postJson<{ response?: unknown }>(
      `/jwt/pronexis/${pocomosOffice()}/customer/search`,
      { id: sample.id }
    );
    console.log("search response keys:", summarizeKeys(search));
    if (search.response) {
      console.log(
        "search.response shape:",
        Array.isArray(search.response)
          ? `array(${(search.response as unknown[]).length})`
          : summarizeKeys(search.response)
      );
      const first = Array.isArray(search.response)
        ? (search.response as Array<Record<string, unknown>>)[0]
        : (search.response as Record<string, unknown>);
      if (first) {
        console.log("first search result scalars:", scalarSnapshot(first));
      }
    }
  } catch (e) {
    console.log("search endpoint failed:", (e as Error).message);
  }

  console.log("\n=== Probe done ===");
})();
