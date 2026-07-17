/**
 * READ-ONLY diff: the /sales "Returning" (RETAINED) bucket vs the 25→26
 * return-rate NUMERATOR (counts-based: >= MIN completed mosquito services in both
 * 2025 and 2026). Writes two gitignored CSVs + prints reason summaries.
 *
 *   A. returning-not-in-numerator.csv  — in Returning, NOT in the numerator
 *   B. numerator-not-in-returning.csv  — in the numerator, NOT in Returning
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/diff-returning-vs-returnrate.ts
 */
import { writeFileSync } from "node:fs";
import { getDataset, bucketFor, CURRENT_YEAR } from "../src/lib/pocomos";
import { sql } from "../src/lib/db";
import { buildServiceCountCohort, getServiceCountsData } from "../src/lib/service/serviceCounts";

const MIN = 2; // MIN_RETURN_TREATMENTS
const CY = Number(CURRENT_YEAR); // 2026
const FROM = CY - 1; // 2025
const TO = CY; // 2026

interface Rec {
  id: string;
  name: string;
  status: string; // lowercased: active | inactive | on-hold
  unionTags: string[];
}

(async () => {
  const ds = await getDataset({ force: true });
  const recs = new Map<string, Rec>();
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    recs.set(String(c.id), { id: String(c.id), name: c.fullName, status: "active", unionTags: c.tags });
  }
  const nonActive = (await sql`
    SELECT pocomos_id, full_name, status, tags FROM customers WHERE lower(status) <> 'active'
  `) as Array<{ pocomos_id: string; full_name: string; status: string; tags: unknown }>;
  for (const r of nonActive) {
    const id = String(r.pocomos_id);
    if (recs.has(id)) continue;
    recs.set(id, {
      id,
      name: r.full_name || id,
      status: r.status.toLowerCase(),
      unionTags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    });
  }

  const cohort = await buildServiceCountCohort();
  const cohortIds = new Set(cohort.map((m) => m.id));
  const cohortName = new Map(cohort.map((m) => [m.id, m.name]));
  const data = await getServiceCountsData();

  const count = (id: string, y: number): number => data.counts.get(id)?.[y] ?? 0;
  const isReal = (id: string, y: number): boolean => data.tableOk.has(id) && count(id, y) >= MIN;

  // Returning bucket (RETAINED) = active customers whose 2026 union-tag bucket is RETAINED.
  const returning = new Set<string>();
  for (const rec of recs.values()) {
    if (rec.status !== "active") continue;
    if (bucketFor(new Set(rec.unionTags), String(TO)) === "RETAINED") returning.add(rec.id);
  }
  // 25→26 numerator = cohort members real in BOTH 2025 and 2026.
  const numerator = new Set<string>();
  for (const id of cohortIds) if (isReal(id, FROM) && isReal(id, TO)) numerator.add(id);

  console.log(`Returning bucket (active + RETAINED ${TO}): ${returning.size}`);
  console.log(`25→26 numerator (>=${MIN} sprays in ${FROM} AND ${TO}): ${numerator.size}`);

  const tags2026 = (rec: Rec | undefined) =>
    (rec?.unionTags || []).filter((t) => t.startsWith(`${TO} -`)).join("; ");
  const sprayCell = (id: string, y: number): string =>
    data.tableOk.has(id) ? String(count(id, y)) : data.scraped.has(id) ? "n/a(add-on)" : "not scraped";

  // ---- Direction A: in Returning, NOT in numerator — WHY not counted? ----
  const reasonA = (id: string): string => {
    if (!data.scraped.has(id)) return "no service-count data (not scraped)";
    if (!data.tableOk.has(id)) return "no service-count data (add-on: mosquito table not read)";
    if (count(id, FROM) < MIN) return `<${MIN} sprays in ${FROM}`;
    if (count(id, TO) < MIN) return `<${MIN} sprays in ${TO} so far`;
    return "unexpected — should be in numerator";
  };
  // ---- Direction B: in numerator, NOT in Returning — WHY not in bucket? ----
  const reasonB = (rec: Rec | undefined, id: string): string => {
    if (!rec) return "not in active dataset / customers table";
    if (rec.status !== "active") return `not currently active (status=${rec.status})`;
    const b = bucketFor(new Set(rec.unionTags), String(TO));
    if (b === "NEW" || b === "RETURNING") return `${TO} - New Sale re-signup (bucket ${b})`;
    if (b === "AT_RISK") return `no ${TO} continuation tag (only prior-year tags)`;
    if (b == null) return `no ${TO} tag at all`;
    return `bucket ${b} (unexpected)`;
  };

  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["name", "pocomos_id", "status", `tags_${TO}`, `sprays_${FROM}`, `sprays_${TO}`, "reason"];

  const writeCsv = (
    file: string,
    ids: string[],
    reasonFn: (id: string) => string
  ): Map<string, number> => {
    const lines = [header.join(",")];
    const byReason = new Map<string, number>();
    const rows = ids
      .map((id) => ({ id, rec: recs.get(id) }))
      .sort((a, b) => (a.rec?.name || a.id).localeCompare(b.rec?.name || b.id));
    for (const { id, rec } of rows) {
      const reason = reasonFn(id);
      byReason.set(reason, (byReason.get(reason) || 0) + 1);
      lines.push(
        [
          esc(rec?.name || cohortName.get(id) || id),
          esc(id),
          esc(rec?.status || "?"),
          esc(tags2026(rec)),
          esc(sprayCell(id, FROM)),
          esc(sprayCell(id, TO)),
          esc(reason),
        ].join(",")
      );
    }
    writeFileSync(file, lines.join("\n") + "\n", "utf8");
    return byReason;
  };

  const aIds = [...returning].filter((id) => !numerator.has(id));
  const bIds = [...numerator].filter((id) => !returning.has(id));

  const aReasons = writeCsv("returning-not-in-numerator.csv", aIds, reasonA);
  const bReasons = writeCsv("numerator-not-in-returning.csv", bIds, (id) => reasonB(recs.get(id), id));

  const printSummary = (title: string, total: number, m: Map<string, number>) => {
    console.log(`\n===== ${title}: ${total} =====`);
    for (const [reason, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${reason}`);
    }
  };
  printSummary("A. In Returning but NOT in numerator (returning-not-in-numerator.csv)", aIds.length, aReasons);
  printSummary("B. In numerator but NOT in Returning (numerator-not-in-returning.csv)", bIds.length, bReasons);

  console.log(
    `\noverlap (in both): ${[...numerator].filter((id) => returning.has(id)).length}`
  );
  console.log("\ndone.");
  process.exit(0);
})().catch((e) => {
  console.error("DIFF FAILED:", e);
  process.exit(1);
});
