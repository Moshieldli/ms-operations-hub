/**
 * PROBE (read-only): exact set diff between the OLD Returning box (tag-based
 * RETAINED: active + a CY continuation tag + no CY New Sale) and the NEW rev-17
 * box (prior-year real AND returned). Explains the delta by reason so the
 * REFERENCE reconciliation paragraph states facts, not inferred arithmetic.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-box-diff.ts
 */
import { getDataset, bucketFor, CURRENT_YEAR } from "../src/lib/pocomos";
import { buildServiceCountCohort, getServiceCountsData } from "../src/lib/service/serviceCounts";
import { LATE_SEASON_CUTOFF, REAL_CUSTOMER_MIN_SERVICES } from "../src/lib/sales-taxonomy";

const CY = Number(CURRENT_YEAR);
const FROM = CY - 1;
const CONT = ["Auto", "SEB", "EB", "Renewed", "Prepaid", "Committed"];

function isLate(iso: string): boolean {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return false;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  if (mm !== LATE_SEASON_CUTOFF.month) return mm > LATE_SEASON_CUTOFF.month;
  return dd > LATE_SEASON_CUTOFF.day;
}

(async () => {
  const [cohort, data, ds] = await Promise.all([
    buildServiceCountCohort(),
    getServiceCountsData(),
    getDataset({ force: false }),
  ]);
  const byId = new Map(cohort.map((m) => [m.id, m]));

  const isReal = (id: string, y: number): boolean => {
    if (!data.tableOk.has(id)) return false;
    const n = data.counts.get(id)?.[y] ?? 0;
    if (n >= REAL_CUSTOMER_MIN_SERVICES) return true;
    if (n !== 1) return false;
    const f = data.firstDates.get(id)?.[y];
    return f ? isLate(f) : false;
  };
  const contTag = (id: string): boolean => {
    const m = byId.get(id);
    if (!m || !m.active) return false;
    const tags = new Set(m.tags);
    return CONT.some((t) => tags.has(`${CY} - ${t}`));
  };
  const returned = (id: string) => isReal(id, CY) || contTag(id);

  // OLD box: active customers whose CY union-tag bucket is RETAINED.
  const oldBox = new Set<string>();
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    if (bucketFor(new Set(c.tags), String(CY)) === "RETAINED") oldBox.add(String(c.id));
  }
  // NEW box: prior-year real AND returned.
  const newBox = new Set<string>();
  for (const m of cohort) if (isReal(m.id, FROM) && returned(m.id)) newBox.add(m.id);

  console.log(`OLD box ${oldBox.size} · NEW box ${newBox.size} · delta ${newBox.size - oldBox.size}`);

  // A: in OLD, not in NEW — why dropped?
  const aReasons = new Map<string, number>();
  for (const id of oldBox) {
    if (newBox.has(id)) continue;
    let r: string;
    if (!byId.has(id)) r = `not in mosquito cohort (no mosquito contract w/ a recent year tag)`;
    else if (!data.tableOk.has(id)) r = `no readable mosquito history (table_ok=false)`;
    else if (!isReal(id, FROM)) {
      const n = data.counts.get(id)?.[FROM] ?? 0;
      r = n === 0 ? `not a real ${FROM} customer (0 ${FROM} sprays)` : `not a real ${FROM} customer (single early/mid-season ${FROM} spray)`;
    } else r = `unexpected — real ${FROM} + in old box but not returned`;
    aReasons.set(r, (aReasons.get(r) || 0) + 1);
  }
  // B: in NEW, not in OLD — why added?
  const bReasons = new Map<string, number>();
  for (const id of newBox) {
    if (oldBox.has(id)) continue;
    const m = byId.get(id);
    let r: string;
    if (!m?.active) r = `non-active, qualified on ${CY} spray history`;
    else if (!contTag(id)) r = `active, no ${CY} continuation tag — qualified on ${CY} sprays`;
    else r = `active w/ continuation tag but old box excluded it (has a ${CY} New Sale tag)`;
    bReasons.set(r, (bReasons.get(r) || 0) + 1);
  }

  const dump = (title: string, m: Map<string, number>) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`\n${title}: ${total}`);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
  };
  dump("A. In OLD box, NOT in NEW box (dropped)", aReasons);
  dump("B. In NEW box, NOT in OLD box (added)", bReasons);

  const dropped = [...oldBox].filter((id) => !newBox.has(id)).length;
  const added = [...newBox].filter((id) => !oldBox.has(id)).length;
  console.log(`\ncheck: ${oldBox.size} - ${dropped} + ${added} = ${oldBox.size - dropped + added} (NEW box ${newBox.size})`);
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
