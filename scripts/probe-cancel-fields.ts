/**
 * Probe: what does an Inactive customer look like, and where does the
 * cancellation date live? Check customer-level fields first; if missing,
 * dump a sample inactive customer's contracts to find date_cancelled.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-cancel-fields.ts
 */
import { fetchAllCustomers, fetchContractsForCustomers } from "../src/lib/pocomos";

function statusOf(s: unknown) {
  return String(s || "").toLowerCase();
}

function fullKeyDump(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      lines.push(`${prefix}${k}: <object> ${Object.keys(v as Record<string, unknown>).join(", ")}`);
    } else if (Array.isArray(v)) {
      lines.push(`${prefix}${k}: array(${v.length})`);
    } else {
      lines.push(`${prefix}${k} = ${String(v).slice(0, 80)}`);
    }
  }
  return lines;
}

(async () => {
  const all = await fetchAllCustomers();
  console.log(`Total customers: ${all.length}`);

  const byStatus: Record<string, number> = {};
  for (const c of all) {
    const s = statusOf(c.status);
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  console.log("By status:", byStatus);

  const inactive = all.filter((c) => statusOf(c.status) === "inactive");
  console.log(`\nInactive: ${inactive.length}`);

  // Look at the union of keys present across inactive customers.
  const allKeys = new Set<string>();
  for (const c of inactive) for (const k of Object.keys(c)) allKeys.add(k);
  console.log("\nUnion of all keys on inactive customers:");
  console.log("  " + Array.from(allKeys).sort().join(", "));

  // Check for date-ish keys specifically.
  const dateLikeKeys = Array.from(allKeys).filter((k) =>
    /(date|cancel|inactive|deactiv|terminat|status|active|expir|end)/i.test(k)
  );
  console.log("\nDate / status-like keys:", dateLikeKeys);

  // Sample 3 inactive customers, dump scalar fields.
  console.log("\n=== Sample inactive customer scalars ===");
  for (const c of inactive.slice(0, 3)) {
    console.log(`\n--- customer ${c.id} ---`);
    for (const line of fullKeyDump(c)) console.log("  " + line);
  }

  // Check if any inactive customer has a populated cancel-y field at the top level.
  const cancelishKeyCandidates = [
    "date_cancelled",
    "dateCancelled",
    "cancellation_date",
    "cancellationDate",
    "deactivated_at",
    "deactivatedAt",
    "date_inactive",
    "dateInactive",
    "date_end",
    "dateEnd",
    "terminated_at",
    "terminatedAt",
    "status_modified",
    "statusModified",
    "sales_status_modified",
    "salesStatusModified",
    "date_modified",
    "dateModified",
  ];
  console.log("\nCancellation-field coverage at customer level:");
  for (const k of cancelishKeyCandidates) {
    let count = 0;
    for (const c of inactive) {
      const v = (c as Record<string, unknown>)[k];
      if (v != null && String(v).trim() && String(v).trim() !== "0") count++;
    }
    console.log(`  ${k}: ${count} / ${inactive.length} populated`);
  }

  // If nothing useful at customer level, probe one inactive customer's contracts.
  console.log("\n=== Inactive customer contracts probe ===");
  const sample = inactive[0];
  const { results } = await fetchContractsForCustomers([sample.id]);
  const contracts = results.get(sample.id) || [];
  console.log(`Customer ${sample.id} has ${contracts.length} contracts`);
  for (let i = 0; i < Math.min(contracts.length, 3); i++) {
    const c = contracts[i];
    console.log(`\n--- contract ${i} (status=${c.status}) ---`);
    for (const line of fullKeyDump(c)) console.log("  " + line);
    if (c.pest_contract) {
      console.log("  pest_contract scalars:");
      for (const line of fullKeyDump(c.pest_contract, "    ")) console.log(line);
    }
  }
})();
