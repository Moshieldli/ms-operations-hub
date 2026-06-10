/**
 * Audit probe: print every active customer the dashboard buckets as RETURNING.
 *
 * Uses the same data layer + categorization as /sales: getDataset() for the
 * customers and bucketFor() from categorize.ts for the bucket decision, so the
 * count here matches the dashboard's "Returning" number exactly.
 *
 * RETURNING = has "{CURRENT_YEAR} - New Sale" AND at least one prior-year YYYY
 * tag (i.e. signed this year, but was a customer before).
 *
 * Note on external Customer ID: the dashboard data layer does not carry it.
 * fetchAllCustomers() returns a slim 9-field record (no external_account_id),
 * and the contract payload's `profile` is the billing profile (payment
 * accounts), not the account profile — so external_account_id is unavailable
 * here. The internal id printed below is the one Pocomos uses in customer URLs
 * (https://mypocomos.net/customer/{id}/customer-information).
 *
 * Read-only. No writes.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/list-returning.ts
 */
import { getDataset, bucketFor, CURRENT_YEAR } from "../src/lib/pocomos";
import type { NormalizedCustomer } from "../src/lib/pocomos";

const EXTERNAL_ID_KEYS = [
  "externalAccountId",
  "external_account_id",
  "customerNumber",
  "customer_number",
];

function externalIdOf(c: NormalizedCustomer): string {
  const r = c as Record<string, unknown>;
  for (const k of EXTERNAL_ID_KEYS) {
    if (r[k] != null && String(r[k]).trim()) return String(r[k]);
  }
  return "(n/a — not in dataset)";
}

(async () => {
  const ds = await getDataset({ force: true });

  const returning = ds.customers.filter(
    (c) =>
      c.status.toLowerCase() === "active" &&
      bucketFor(new Set(c.tags), CURRENT_YEAR) === "RETURNING"
  );

  console.log(`RETURNING customers (${CURRENT_YEAR}):\n`);
  returning
    .sort((a, b) => Number(a.id) - Number(b.id))
    .forEach((c, i) => {
      const tags = [...c.tags].sort();
      console.log(`${i + 1}. internal id : ${c.id}`);
      console.log(`   customer id : ${externalIdOf(c)}`);
      console.log(`   name        : ${c.fullName}`);
      console.log(`   tags (${tags.length}) : ${tags.join(", ") || "(none)"}`);
      console.log("");
    });

  console.log(`Total RETURNING: ${returning.length}`);
})();
