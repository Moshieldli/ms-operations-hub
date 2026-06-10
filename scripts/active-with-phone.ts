/**
 * One-off probe: dump every active customer (status === "active") with phone
 * to docs/active-with-phone.csv. Same active rule + data layer as the
 * dashboard (dataset.ts buildDataset) and scripts/list-active-ids.ts.
 *
 * All four columns come from the slim customer-list record returned by
 * fetchAllCustomers() (id, firstName, lastName, phone are present there).
 *
 * Read-only. No Postgres writes. No Pocomos writes.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/active-with-phone.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchAllCustomers } from "../src/lib/pocomos";

function pick(c: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = c[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

(async () => {
  const all = await fetchAllCustomers();
  const active = all.filter((c) => String(c.status).toLowerCase() === "active");
  active.sort((a, b) => Number(a.id) - Number(b.id));

  const rows = active.map((c) => {
    const r = c as Record<string, unknown>;
    return [
      csvCell(String(r.id ?? "")),
      csvCell(pick(r, "firstName", "first_name")),
      csvCell(pick(r, "lastName", "last_name")),
      csvCell(pick(r, "phone", "phoneNumber", "phone_number")),
    ].join(",");
  });

  const csv = ["id,first_name,last_name,phone", ...rows].join("\n") + "\n";
  const outPath = path.join(__dirname, "..", "docs", "active-with-phone.csv");
  fs.writeFileSync(outPath, csv, "utf8");

  const withPhone = active.filter(
    (c) => pick(c as Record<string, unknown>, "phone", "phoneNumber", "phone_number") !== ""
  ).length;
  console.log(`Active customers: ${active.length}`);
  console.log(`  with a phone: ${withPhone} | without: ${active.length - withPhone}`);
  console.log(`Wrote -> ${outPath}`);
})();
