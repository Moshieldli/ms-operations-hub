/**
 * Probe the new contract-level tags endpoint:
 *   GET /jwt/office/{office}/contract/{pestContractId}/tags
 *
 * We don't yet know exactly which id field maps to "pestContractId" — the
 * existing PocomosContract has `contract.id` and `contract.pest_contract.{...}`.
 * This probe pulls one active customer, lists their contracts, and tries the
 * new endpoint against each plausible id (contract.id, pest_contract.id, ...)
 * so we can see which one returns tag data.
 */
import {
  fetchActiveCustomers,
  fetchContractsForCustomers,
  getJson,
  pocomosOffice,
} from "../src/lib/pocomos";

function keys(obj: unknown): string {
  if (!obj || typeof obj !== "object") return String(typeof obj);
  return Object.keys(obj as Record<string, unknown>).join(", ");
}

async function tryGet(path: string, label: string) {
  try {
    const data = await getJson<unknown>(path);
    console.log(`\n✓ ${label}`);
    console.log(`  path: ${path}`);
    const raw = JSON.stringify(data);
    console.log(`  raw (first 600): ${raw.slice(0, 600)}`);
    if (data && typeof data === "object") {
      const top = data as Record<string, unknown>;
      console.log(`  top keys: ${Object.keys(top).join(", ")}`);
      const r = top.response;
      if (Array.isArray(r)) {
        console.log(`  response = array(${r.length})`);
        if (r.length) {
          console.log(`  first entry: ${JSON.stringify(r[0]).slice(0, 400)}`);
        }
      } else if (r && typeof r === "object") {
        console.log(`  response keys: ${keys(r)}`);
      }
    }
    return data;
  } catch (e) {
    console.log(`\n✗ ${label}`);
    console.log(`  path: ${path}`);
    console.log(`  error: ${(e as Error).message.slice(0, 200)}`);
    return null;
  }
}

(async () => {
  const office = pocomosOffice();
  console.log(`Office: ${office}`);

  console.log("\n=== Fetching active customers ===");
  const active = await fetchActiveCustomers();
  console.log(`Active customers: ${active.length}`);

  // Take a handful so we have variety of contract shapes.
  const sampleCustomers = active.slice(0, 5);
  const ids = sampleCustomers.map((c) => c.id);
  console.log(`Sampling customer ids: ${ids.join(", ")}`);

  console.log("\n=== Fetching contracts for those customers ===");
  const { results } = await fetchContractsForCustomers(ids);

  // Find the first customer with at least one contract.
  let target: { customerId: string | number; contract: Record<string, unknown> } | null = null;
  for (const cid of ids) {
    const contracts = results.get(cid) || [];
    if (contracts.length) {
      target = { customerId: cid, contract: contracts[0] as Record<string, unknown> };
      console.log(`\n--- Using customer ${cid} (${contracts.length} contracts) ---`);
      break;
    }
  }
  if (!target) {
    console.log("No contracts found for any sampled customer — aborting.");
    return;
  }

  const contract = target.contract;
  console.log("\nContract top-level keys:");
  console.log("  " + keys(contract));
  console.log("\nContract scalars (for id hunting):");
  for (const [k, v] of Object.entries(contract)) {
    if (v != null && typeof v !== "object") {
      console.log(`  ${k} = ${String(v).slice(0, 80)}`);
    }
  }

  const pc = (contract.pest_contract as Record<string, unknown>) || {};
  console.log("\npest_contract keys:");
  console.log("  " + keys(pc));
  console.log("pest_contract scalars:");
  for (const [k, v] of Object.entries(pc)) {
    if (v != null && typeof v !== "object") {
      console.log(`  ${k} = ${String(v).slice(0, 80)}`);
    }
  }

  // Collect candidate ids to try as pestContractId.
  const candidates: Array<{ source: string; id: unknown }> = [];
  for (const [k, v] of Object.entries(contract)) {
    if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
      if (k.toLowerCase().includes("id") || k === "id") candidates.push({ source: `contract.${k}`, id: v });
    }
  }
  for (const [k, v] of Object.entries(pc)) {
    if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
      if (k.toLowerCase().includes("id") || k === "id") candidates.push({ source: `pest_contract.${k}`, id: v });
    }
  }
  console.log("\nCandidate ids to try:");
  for (const c of candidates) console.log(`  ${c.source} = ${c.id}`);

  console.log("\n=== Trying new endpoint with each candidate ===");
  for (const c of candidates) {
    await tryGet(
      `/jwt/office/${office}/contract/${c.id}/tags`,
      `${c.source} (${c.id})`
    );
  }
})();
