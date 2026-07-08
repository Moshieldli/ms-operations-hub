/**
 * Return-rate reconciliation + audit list.
 *
 * Reconciles the 25→26 return-rate NUMERATOR (real 2025 mosquito customers who
 * genuinely returned as real 2026 customers) against the /sales "Returning"
 * bucket (RETAINED = 2026 continuation tag). Prints the composition and writes
 * audit-return-gap.csv = every numerator member NOT in the Returning bucket
 * (the re-signups + edge cases that inflate the numerator over the bucket).
 *
 * READ-ONLY. Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/audit-return-gap.ts
 */
import { writeFileSync } from "node:fs";
import { getDataset, bucketFor } from "../src/lib/pocomos";
import { sql } from "../src/lib/db";

const MOSQUITO = new Set(
  ["Mosquito Control", "Natural Mosquito Control", "Mosquito Control - Weekly", "Natural Mosquito Control - Weekly"].map(
    (s) => s.toLowerCase()
  )
);
const isMosq = (s: unknown) => MOSQUITO.has(String(s || "").trim().toLowerCase());
const yearTagOn = (tags: string[] | undefined, y: string) =>
  (tags || []).some((t) => String(t).trim().startsWith(`${y} -`));

interface Rec {
  id: string;
  name: string;
  status: string;
  contracts: Array<{ serviceType?: string | null; tags?: string[] }>;
  unionTags: string[];
  lastService: string | null;
}

(async () => {
  const ds = await getDataset({ force: true });
  const recs = new Map<string, Rec>();
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    recs.set(String(c.id), {
      id: String(c.id),
      name: c.fullName,
      status: "active",
      contracts: c.contracts.map((k) => ({ serviceType: k.serviceType, tags: k.tags })),
      unionTags: c.tags,
      lastService: c.lastServiceDate ?? null,
    });
  }
  const nonActive = (await sql`
    SELECT pocomos_id, full_name, status, tags, contracts, last_service_date
    FROM customers WHERE lower(status) <> 'active'
  `) as Array<{ pocomos_id: string; full_name: string; status: string; tags: unknown; contracts: unknown; last_service_date: string | null }>;
  for (const r of nonActive) {
    const id = String(r.pocomos_id);
    if (recs.has(id)) continue;
    recs.set(id, {
      id,
      name: r.full_name || id,
      status: r.status.toLowerCase(),
      contracts: Array.isArray(r.contracts) ? (r.contracts as Rec["contracts"]) : [],
      unionTags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      lastService: r.last_service_date,
    });
  }

  const realStrict = (rec: Rec, y: string) =>
    rec.contracts.some((c) => isMosq(c.serviceType) && yearTagOn(c.tags, y));
  const isMidSeasonCancel = (rec: Rec, y: string) =>
    rec.status === "inactive" && String(rec.lastService || "").slice(0, 4) === y;
  const realValidated = (rec: Rec, y: string) => realStrict(rec, y) && !isMidSeasonCancel(rec, y);

  // Numerator: real 2025 AND validated-real 2026.
  const numerator: Rec[] = [];
  for (const rec of recs.values()) {
    if (realStrict(rec, "2025") && realValidated(rec, "2026")) numerator.push(rec);
  }

  // Returning bucket (RETAINED) = active customers whose 2026 bucket is RETAINED.
  const retainedIds = new Set<string>();
  for (const rec of recs.values()) {
    if (rec.status !== "active") continue;
    if (bucketFor(new Set(rec.unionTags), "2026") === "RETAINED") retainedIds.add(rec.id);
  }

  // Composition of the numerator by 2026 signal.
  let contWithNewSale = 0;
  let newSaleOnly = 0;
  let continuationOnly = 0;
  let other = 0;
  let violations = 0;
  for (const rec of numerator) {
    // assertion: must have a 2025 mosquito contract carrying a 2025 tag
    if (!realStrict(rec, "2025")) {
      violations++;
      console.log(`  VIOLATION ${rec.id} ${rec.name}: numerator member without real 2025 mosquito+tag`);
    }
    const hasNewSale = rec.unionTags.includes("2026 - New Sale");
    const hasCont =
      rec.unionTags.some((t) =>
        ["2026 - Auto", "2026 - SEB", "2026 - EB", "2026 - Prepaid", "2026 - Committed", "2026 - Renewed"].includes(t)
      );
    if (hasCont && hasNewSale) contWithNewSale++;
    else if (hasNewSale) newSaleOnly++;
    else if (hasCont) continuationOnly++;
    else other++;
  }

  const gap = numerator.filter((rec) => !retainedIds.has(rec.id));

  console.log("\n===== RETURN-RATE RECONCILIATION (25→26) =====");
  console.log(`numerator (real 2025 → validated-real 2026): ${numerator.length}`);
  console.log(`Returning bucket (active + RETAINED 2026):    ${retainedIds.size}`);
  console.log(`gap (numerator NOT in Returning bucket):      ${gap.length}`);
  console.log("\nnumerator composition by 2026 tag signal:");
  console.log(`  continuation only (Auto/SEB/EB/Prepaid/Committed/Renewed): ${continuationOnly}`);
  console.log(`  2026 New Sale only (re-signup):                            ${newSaleOnly}`);
  console.log(`  BOTH continuation + New Sale:                              ${contWithNewSale}`);
  console.log(`  neither (edge/other):                                      ${other}`);
  console.log(`  assertion violations (no real 2025 mosquito+tag):          ${violations}`);

  // Status breakdown of the gap.
  const gapByStatus = new Map<string, number>();
  for (const rec of gap) gapByStatus.set(rec.status, (gapByStatus.get(rec.status) || 0) + 1);
  console.log("\ngap by current status:", JSON.stringify(Object.fromEntries(gapByStatus)));

  // CSV.
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["name", "pocomos_id", "status", "tags_2025", "tags_2026", "contract_types", "profile_url"];
  const lines = [header.join(",")];
  const printRows: string[] = [];
  for (const rec of gap.sort((a, b) => a.name.localeCompare(b.name))) {
    const t25 = rec.unionTags.filter((t) => t.startsWith("2025 -")).join("; ");
    const t26 = rec.unionTags.filter((t) => t.startsWith("2026 -")).join("; ");
    const types = [...new Set(rec.contracts.map((c) => c.serviceType || "").filter(Boolean))].join("; ");
    const url = `https://mypocomos.net/customer/${rec.id}/service-information`;
    lines.push([esc(rec.name), esc(rec.id), esc(rec.status), esc(t25), esc(t26), esc(types), esc(url)].join(","));
    printRows.push(`  ${rec.name} (${rec.id}) [${rec.status}] 2025:{${t25}} 2026:{${t26}} types:{${types}}`);
  }
  writeFileSync("audit-return-gap.csv", lines.join("\n") + "\n", "utf8");
  console.log(`\nwrote audit-return-gap.csv (${gap.length} rows)`);
  console.log("\n===== FULL GAP LIST =====");
  console.log(printRows.join("\n"));
  console.log("\n=== audit-return-gap done ===");
})().catch((e) => {
  console.error("AUDIT FAILED:", e);
  process.exit(1);
});
