/**
 * One-off probe: print the IDs behind the dashboard's "Active Customers"
 * number so it can be reconciled against a Pocomos UI search.
 *
 * Uses the same data layer + "active" rule as dataset.ts buildDataset:
 *   active  := String(c.status).toLowerCase() === "active"
 * That set is the dashboard's 1081. The dashboard does NOT exclude
 * cancelled-flagged actives, but a Pocomos search might — so we also split
 * the active set by sales_status to surface the prime suspects for the gap.
 *
 * Read-only. No Postgres writes. No Pocomos writes. Output is a single
 * text file under docs/.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/list-active-ids.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchAllCustomers } from "../src/lib/pocomos";

// Mirror dataset.ts pickString: the API can return either camelCase or
// snake_case, so read both keys before applying the "cancel" rule. Reading
// only `sales_status` would miss camelCase values and undercount flagged.
function salesStatusOf(c: Record<string, unknown>): string {
  const v = c.salesStatus ?? c.sales_status;
  return v == null ? "" : String(v);
}

(async () => {
  const all = await fetchAllCustomers();

  // 1 + 2. Dashboard "active" set.
  const active = all.filter(
    (c) => String(c.status).toLowerCase() === "active"
  );
  const ids = active
    .map((c) => Number(c.id))
    .sort((a, b) => a - b);

  console.log(`Active customers (status === "active"): ${active.length}`);

  // 4. Split by sales_status.
  const clean: number[] = [];
  const cancelledFlagged: number[] = [];
  for (const c of active) {
    const ss = salesStatusOf(c as Record<string, unknown>).toLowerCase();
    if (ss.includes("cancel")) {
      cancelledFlagged.push(Number(c.id));
    } else {
      clean.push(Number(c.id));
    }
  }
  clean.sort((a, b) => a - b);
  cancelledFlagged.sort((a, b) => a - b);

  // 3. Write the full active id list to docs/.
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(
    __dirname,
    "..",
    "docs",
    `active-ids-${today}.txt`
  );
  fs.writeFileSync(outPath, ids.join("\n") + "\n", "utf8");
  console.log(`Wrote ${ids.length} active IDs -> ${outPath}`);

  console.log(`\nclean actives (sales_status NOT containing "cancel"): ${clean.length}`);
  console.log(
    `cancelled-flagged actives (status=active BUT sales_status contains "cancel"): ${cancelledFlagged.length}`
  );
  console.log(`cancelled-flagged IDs: ${cancelledFlagged.join(", ") || "(none)"}`);

  // 5. One-line summary.
  console.log(
    `\nSUMMARY: total active ${active.length} | clean ${clean.length} | cancelled-flagged ${cancelledFlagged.length}`
  );
})();
