/**
 * READ-ONLY roster: ACTIVE customers holding a {CY} continuation tag who had
 * ZERO completed {CY-1} mosquito sprays — the "renewed without a prior season"
 * subset from the rev-17 reconciliation (REFERENCE §5.8: the 42 of the 55 that
 * dropped out of the Returning box).
 *
 * Membership mirrors the shipped rule exactly:
 *   - in the mosquito cohort (buildServiceCountCohort) AND table_ok (history
 *     readable — the 7 table_ok=false customers are a SEPARATE bucket and are
 *     excluded here, matching the reconciliation's 42),
 *   - ACTIVE + a {CY} continuation tag (hasContinuationTag path of rule 2),
 *   - sprays_{CY-1} === 0.
 *
 * Writes renewed-no-2025-season.csv (gitignored: *.csv) + prints the roster.
 * Reads Neon + the cached dataset only. No Pocomos writes, no contract switch.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/list-renewed-no-2025-season.ts
 */
import { writeFileSync } from "node:fs";
import { getDataset, CURRENT_YEAR } from "../src/lib/pocomos";
import { buildServiceCountCohort, getServiceCountsData } from "../src/lib/service/serviceCounts";
import { isMosquitoServiceType } from "../src/lib/service/mosquito";

const POCOMOS_BASE = process.env.POCOMOS_BASE || "https://mypocomos.net";
const CY = Number(CURRENT_YEAR);
const PY = CY - 1;
// Same set the shipped rule accepts (CONTINUATION_TAGS_ALL in sales-taxonomy.ts).
const CONT = ["Auto", "SEB", "EB", "Renewed", "Prepaid", "Committed"];

/** "YYYY-MM-DD HH:MM:SS" | Date | null → "YYYY-MM-DD" | "". */
const day = (v: unknown): string => {
  if (!v) return "";
  const m = String(v).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};
const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;

(async () => {
  const [cohort, data, ds] = await Promise.all([
    buildServiceCountCohort(),
    getServiceCountsData(),
    getDataset({ force: false }),
  ]);
  const inCohort = new Set(cohort.map((m) => m.id));
  const custById = new Map(ds.customers.map((c) => [String(c.id), c]));

  const rows: Array<Record<string, string>> = [];
  for (const c of ds.customers) {
    const id = String(c.id);
    if (c.status.toLowerCase() !== "active") continue;
    if (!inCohort.has(id)) continue;
    if (!data.tableOk.has(id)) continue; // table_ok=false = the other bucket
    const tags = new Set(c.tags);
    if (!CONT.some((t) => tags.has(`${CY} - ${t}`))) continue;
    if ((data.counts.get(id)?.[PY] ?? 0) !== 0) continue;

    // Earliest/latest mosquito contract start — the best "signed up" evidence we
    // hold without a scrape; customer dateCreated is the account-level signup.
    const mosqStarts = c.contracts
      .filter((k) => isMosquitoServiceType(k.serviceType))
      .map((k) => day(k.dateStart))
      .filter(Boolean)
      .sort();

    rows.push({
      name: c.fullName,
      pocomos_id: id,
      status: c.status,
      tags_2025: [...tags].filter((t) => t.startsWith(`${PY} -`)).sort().join("; "),
      tags_2026: [...tags].filter((t) => t.startsWith(`${CY} -`)).sort().join("; "),
      sprays_2025: String(data.counts.get(id)?.[PY] ?? 0),
      sprays_2026: String(data.counts.get(id)?.[CY] ?? 0),
      first_spray_2026: data.firstDates.get(id)?.[CY] ?? "",
      last_spray_2026: data.lastDates.get(id)?.[CY] ?? "",
      last_service_any_type: day(c.lastServiceDate),
      next_service: day(c.nextServiceDate),
      account_created: day(c.dateCreated),
      mosquito_contract_start: mosqStarts[0] ?? "",
      profile_url: `${POCOMOS_BASE}/customer/${id}/service-information`,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const header = [
    "name",
    "pocomos_id",
    "status",
    "tags_2025",
    "tags_2026",
    "sprays_2025",
    "sprays_2026",
    "first_spray_2026",
    "last_spray_2026",
    "last_service_any_type",
    "next_service",
    "account_created",
    "mosquito_contract_start",
    "profile_url",
  ];
  const file = "renewed-no-2025-season.csv";
  writeFileSync(
    file,
    [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n",
    "utf8"
  );

  console.log(
    `ACTIVE + ${CY} continuation tag + ZERO ${PY} mosquito sprays (table_ok only): ${rows.length}\n`
  );
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(26).slice(0, 26)} ${r.pocomos_id.padStart(7)}  ` +
        `${PY}:[${(r.tags_2025 || "—").slice(0, 34).padEnd(34)}] ` +
        `${CY}:[${(r.tags_2026 || "—").slice(0, 30).padEnd(30)}] ` +
        `sprays ${PY}=${r.sprays_2025} ${CY}=${r.sprays_2026}  ` +
        `created ${r.account_created || "—"}  mosq-start ${r.mosquito_contract_start || "—"}  ` +
        `last-svc ${r.last_service_any_type || "—"}`
    );
  }

  // Summaries that explain WHO these are, without another data pull.
  const tally = (label: string, keyFn: (r: Record<string, string>) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) || 0) + 1);
    console.log(`\n${label}`);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}  ${k || "(none)"}`);
    }
  };
  tally(`By ${PY} tags:`, (r) => r.tags_2025 || "(no 2025 tag at all)");
  tally(`By ${CY} continuation tag:`, (r) => r.tags_2026);
  tally(`Has ${CY} sprays?`, (r) => (Number(r.sprays_2026) > 0 ? `yes (${r.sprays_2026})` : "no — not sprayed yet"));
  tally("Account created:", (r) => (r.account_created ? r.account_created.slice(0, 4) : "(unknown)"));

  console.log(`\nCSV → ${file} (gitignored)`);
  process.exit(0);
})().catch((e) => {
  console.error("LIST FAILED:", e);
  process.exit(1);
});
