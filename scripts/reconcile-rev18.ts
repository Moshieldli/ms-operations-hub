/**
 * READ-ONLY reconciliation: what the bulk exports did to the rev-17 blind spot —
 * the 42 "active + 2026 continuation tag but ZERO 2025 sprays" customers, and
 * the 29 of them holding >1 mosquito contract (the suspected false negatives).
 */
import { getDataset, CURRENT_YEAR } from "../src/lib/pocomos";
import { getServiceCountsData } from "../src/lib/service/serviceCounts";
import { isMosquitoServiceType } from "../src/lib/service/mosquito";
import { sql } from "../src/lib/db";

const CY = Number(CURRENT_YEAR);
const PY = CY - 1;
const CONT = ["Auto", "SEB", "EB", "Renewed", "Prepaid", "Committed"];

(async () => {
  const [ds, data] = await Promise.all([getDataset({ force: false }), getServiceCountsData()]);
  const cnt = (id: string, y: number) => data.counts.get(id)?.[y] ?? 0;

  // Rebuild the rev-17 "renewed" population: ACTIVE + a CY continuation tag.
  const renewed = ds.customers.filter((c) => {
    if (c.status.toLowerCase() !== "active") return false;
    const tags = new Set(c.tags);
    return CONT.some((t) => tags.has(`${CY} - ${t}`));
  });
  const zero25 = renewed.filter((c) => cnt(String(c.id), PY) === 0);
  const multi = (c: (typeof renewed)[number]) =>
    c.contracts.filter((k) => isMosquitoServiceType(k.serviceType)).length > 1;

  console.log(`ACTIVE + ${CY} continuation tag: ${renewed.length}`);
  console.log(`  of those, ZERO ${PY} sprays NOW (export-backed): ${zero25.length}   [was 42 under the scrape]`);
  console.log(`  → RESCUED by the export: ${42 - zero25.length}`);
  console.log(`  still zero & multi-contract: ${zero25.filter(multi).length}   [was 29]`);
  console.log(`  still zero & single-contract: ${zero25.filter((c) => !multi(c)).length}   [was 13]`);

  // Where did the rescued ones land?
  const rescued = renewed.filter((c) => cnt(String(c.id), PY) > 0 && multi(c));
  const dist = new Map<number, number>();
  for (const c of rescued) {
    const n = cnt(String(c.id), PY);
    dist.set(n, (dist.get(n) || 0) + 1);
  }
  console.log(`\nmulti-contract renewed customers with ${PY} sprays now: ${rescued.length}`);
  console.log(`  spray-count distribution: ${[...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x:${v}`).join(" · ")}`);

  // The canonical case: Sherly Aminzadeh — scrape said 0 for 2025; the cancelled
  // 2025 contract's own record showed a real season.
  const sherly = "1234543";
  const rows = (await sql`
    SELECT year, service_count, first_service_date, last_service_date, source
    FROM mosquito_service_counts WHERE pocomos_id = ${sherly} ORDER BY year
  `) as any[];
  console.log(`\nSherly Aminzadeh (${sherly}) — the multi-contract exemplar:`);
  for (const r of rows)
    console.log(`   ${r.year} [${r.source}]: ${r.service_count} sprays · ${String(r.first_service_date).slice(0, 10)} → ${String(r.last_service_date).slice(0, 10)}`);
  console.log(`   (rev 17 scrape reported 2025 = 0 — her season sat on a cancelled contract)`);

  // Still-zero singles: genuine no-shows (tag without a season).
  console.log(`\nstill-zero ${PY} customers (tag but no season — correctly excluded), first 8:`);
  for (const c of zero25.slice(0, 8))
    console.log(`   ${String(c.id).padStart(7)} ${c.fullName.padEnd(24).slice(0, 24)} mosq-contracts=${c.contracts.filter((k) => isMosquitoServiceType(k.serviceType)).length} ${CY}sprays=${cnt(String(c.id), CY)}`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
