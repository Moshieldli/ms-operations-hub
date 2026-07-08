/**
 * READ-ONLY diagnostic for the return-rate numerator fix.
 * Reproduces the OLD numbers, models the NEW isReal() predicate, breaks down by
 * status, and lists Returning-bucket customers NOT in the numerator (with reason).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/diag-return-fix.ts
 */
import { writeFileSync } from "node:fs";
import { getDataset, bucketFor, CURRENT_YEAR } from "../src/lib/pocomos";
import { sql } from "../src/lib/db";

const MOSQUITO = new Set(
  ["Mosquito Control", "Natural Mosquito Control", "Mosquito Control - Weekly", "Natural Mosquito Control - Weekly"].map(
    (s) => s.toLowerCase()
  )
);
const isMosq = (s: unknown) => MOSQUITO.has(String(s || "").trim().toLowerCase());
const isEvent = (s: unknown) => /event\s*spray/i.test(String(s || ""));
const yearTagOn = (tags: string[] | undefined, y: string) =>
  (tags || []).some((t) => String(t).trim().startsWith(`${y} -`));
const yearOf = (raw: string | null | undefined) => {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
};

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

  // distinct raw statuses among non-active (to confirm the on-hold string)
  const rawStatuses = new Map<string, number>();
  for (const r of nonActive) rawStatuses.set(r.status, (rawStatuses.get(r.status) || 0) + 1);
  console.log("distinct non-active raw statuses:", JSON.stringify(Object.fromEntries(rawStatuses)));
  const lcStatuses = new Map<string, number>();
  for (const rec of recs.values()) lcStatuses.set(rec.status, (lcStatuses.get(rec.status) || 0) + 1);
  console.log("rec statuses (lowercased):", JSON.stringify(Object.fromEntries(lcStatuses)));

  const realStrict = (rec: Rec, y: string) =>
    rec.contracts.some((c) => isMosq(c.serviceType) && yearTagOn(c.tags, y));
  const isMidSeasonCancel = (rec: Rec, y: string) =>
    rec.status === "inactive" && String(rec.lastService || "").slice(0, 4) === y;
  const realValidatedOld = (rec: Rec, y: string) => realStrict(rec, y) && !isMidSeasonCancel(rec, y);

  // NEW predicate: real {Y} customer = mosquito {Y} tag AND actually materialized
  // that season — active/on-hold now, OR (if inactive) serviced in Y or later.
  const isRealNew = (rec: Rec, y: string) => {
    if (!realStrict(rec, y)) return false;
    if (rec.status === "active" || rec.status === "on-hold") return true;
    const ly = yearOf(rec.lastService);
    return ly != null && ly >= Number(y);
  };

  const cy = Number(CURRENT_YEAR);
  const yearOfLS = (rec: Rec) => yearOf(rec.lastService);
  // SERVICE-BASED, YEAR-AWARE predicate (ops override):
  //  - current (in-progress) year: "is receiving service" = active now (on-hold optional).
  //  - past (completed) year: "received a service in Y" = active/on-hold now (continuity
  //    proxy via the mosquito {Y} tag) OR last-service-year >= Y (direct service evidence).
  const servedInYear = (rec: Rec, y: string, includeOnHold: boolean): boolean => {
    if (!realStrict(rec, y)) return false; // mosquito {Y} enrollment (identifies mosquito + season)
    const active = rec.status === "active";
    const onHold = rec.status === "on-hold";
    if (Number(y) >= cy) {
      // current/in-progress season: must still be a live customer
      return active || (includeOnHold && onHold);
    }
    // completed season
    if (active || (includeOnHold && onHold)) return true;
    const ly = yearOfLS(rec);
    return ly != null && ly >= Number(y);
  };

  for (const includeOnHold of [true, false]) {
    console.log(`\n########## on-hold ${includeOnHold ? "COUNTS as served" : "EXCLUDED"} ##########`);
    for (const [fromN, toN] of [[cy - 2, cy - 1], [cy - 1, cy]] as const) {
      const from = String(fromN);
      const to = String(toN);
      let realFrom = 0, returned = 0;
      let onHoldDenom = 0, onHoldNum = 0;
      // how many numerator members are backed by direct 2025/2026 service evidence
      // (last-service-year >= to) vs tag-proxy only (last service predates `to`)?
      let numDirectEvidence = 0, numTagProxy = 0;
      for (const rec of recs.values()) {
        if (servedInYear(rec, from, includeOnHold)) {
          realFrom++;
          if (rec.status === "on-hold") onHoldDenom++;
          if (servedInYear(rec, to, includeOnHold)) {
            returned++;
            if (rec.status === "on-hold") onHoldNum++;
            const ly = yearOfLS(rec);
            if (rec.status === "active" || (ly != null && ly >= Number(to))) numDirectEvidence++;
            else numTagProxy++;
          }
        }
      }
      const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0");
      console.log(`\n===== ${from}->${to} =====`);
      console.log(`  realFrom(served ${from})=${realFrom}  returned(→${to})=${returned}  RATE=${pct(returned, realFrom)}%`);
      console.log(`  on-hold in denom=${onHoldDenom} in numer=${onHoldNum}`);
      console.log(`  numerator evidence: direct-service(active or last-svc>=${to})=${numDirectEvidence}  tag-proxy-only(last svc < ${to})=${numTagProxy}`);
    }
  }

  // ---- Task #2: Returning bucket (active + RETAINED 2026) NOT in the (OLD) numerator ----
  const to = String(cy), from = String(cy - 1);
  const numeratorIds = new Set<string>();
  for (const rec of recs.values()) if (realStrict(rec, from) && realValidatedOld(rec, to)) numeratorIds.add(rec.id);
  const retained: Rec[] = [];
  for (const rec of recs.values()) {
    if (rec.status !== "active") continue;
    if (bucketFor(new Set(rec.unionTags), to) === "RETAINED") retained.push(rec);
  }
  const notCounted = retained.filter((rec) => !numeratorIds.has(rec.id));
  const reasonOf = (rec: Rec): string => {
    const hasMosqContract = rec.contracts.some((c) => isMosq(c.serviceType));
    const hasEventContract = rec.contracts.some((c) => isEvent(c.serviceType));
    const mosq2025 = rec.contracts.some((c) => isMosq(c.serviceType) && yearTagOn(c.tags, from));
    const mosq2026 = rec.contracts.some((c) => isMosq(c.serviceType) && yearTagOn(c.tags, to));
    if (!hasMosqContract && hasEventContract) return "event-spray-only (no mosquito contract)";
    if (!hasMosqContract) return "no mosquito contract at all";
    if (!mosq2025 && !mosq2026) return "mosquito contract but 2025/2026 tags not on the mosquito contract (on a non-mosquito contract)";
    if (!mosq2025) return "no 2025 mosquito tag (not a real 2025 customer — new/returning-lapsed in 2026)";
    if (!mosq2026) return "no 2026 mosquito tag (2026 continuation tag is on a non-mosquito contract)";
    return "other";
  };
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["name", "pocomos_id", "status", "tags_2025", "tags_2026", "contract_types", "reason", "profile_url"];
  const lines = [header.join(",")];
  const reasonCounts = new Map<string, number>();
  for (const rec of notCounted.sort((a, b) => a.name.localeCompare(b.name))) {
    const reason = reasonOf(rec);
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    const t25 = rec.unionTags.filter((t) => t.startsWith(`${from} -`)).join("; ");
    const t26 = rec.unionTags.filter((t) => t.startsWith(`${to} -`)).join("; ");
    const types = [...new Set(rec.contracts.map((c) => c.serviceType || "").filter(Boolean))].join("; ");
    const url = `https://mypocomos.net/customer/${rec.id}/service-information`;
    lines.push([esc(rec.name), esc(rec.id), esc(rec.status), esc(t25), esc(t26), esc(types), esc(reason), esc(url)].join(","));
  }
  writeFileSync("audit-returning-not-counted.csv", lines.join("\n") + "\n", "utf8");
  console.log(`\n===== RETURNING-BUCKET NOT IN NUMERATOR: ${notCounted.length} (wrote audit-returning-not-counted.csv) =====`);
  console.log("reason breakdown:", JSON.stringify(Object.fromEntries(reasonCounts), null, 2));

  console.log("\n=== diag done ===");
  process.exit(0);
})().catch((e) => {
  console.error("DIAG FAILED:", e);
  process.exit(1);
});
