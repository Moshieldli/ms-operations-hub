/**
 * PROBE (read-only) for the return-rate + Returning-box unification.
 *
 * Computes, on the live 100%-covered service-count cache:
 *   1. OLD rule (rev 16): >=1 spray, single-late-after-Aug-15 EXCLUDED.
 *   2. NEW rule (rev 17): >=2 sprays OR exactly 1 spray AFTER Aug 15.
 *   3. Returning box, old (tag-based RETAINED + active) vs new (combined).
 *   4. Ambiguity probe: how many CY-continuation customers carry ONLY
 *      Prepaid/Committed (i.e. no Auto/SEB/EB/Renewed) — decides whether the
 *      "Auto/SEB/EB/Renewed" tag list in the spec can be taken literally.
 *   5. Numerator vs Returning-box set diff (should be empty by construction).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-return-unification.ts
 */
import { getDataset, CURRENT_YEAR } from "../src/lib/pocomos";
import { sql } from "../src/lib/db";
import { buildServiceCountCohort, getServiceCountsData } from "../src/lib/service/serviceCounts";

const CY = Number(CURRENT_YEAR);
const FROM = CY - 1;

function isLate(iso: string): boolean {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return false;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  if (mm !== 8) return mm > 8;
  return dd > 15;
}

(async () => {
  const [cohort, data, ds] = await Promise.all([
    buildServiceCountCohort(),
    getServiceCountsData(),
    getDataset({ force: false }),
  ]);
  const ids = cohort.map((m) => m.id);

  // ---- customer tags + status (active from live dataset, rest from Neon) ----
  const tagsById = new Map<string, string[]>();
  const statusById = new Map<string, string>();
  for (const c of ds.customers) {
    tagsById.set(String(c.id), c.tags);
    statusById.set(String(c.id), c.status.toLowerCase());
  }
  const rows = (await sql`
    SELECT pocomos_id, status, tags FROM customers WHERE lower(status) <> 'active'
  `) as Array<{ pocomos_id: string; status: string; tags: unknown }>;
  for (const r of rows) {
    const id = String(r.pocomos_id);
    if (statusById.has(id)) continue;
    tagsById.set(id, Array.isArray(r.tags) ? (r.tags as string[]) : []);
    statusById.set(id, r.status.toLowerCase());
  }

  const count = (id: string, y: number): number =>
    data.tableOk.has(id) ? data.counts.get(id)?.[y] ?? 0 : -1;
  const firstOf = (id: string, y: number) => data.firstDates.get(id)?.[y];

  // OLD rule (rev 16): >=1 spray, EXCEPT a single spray after Aug 15.
  const isRealOld = (id: string, y: number): boolean => {
    const n = count(id, y);
    if (n < 1) return false;
    if (n >= 2) return true;
    const f = firstOf(id, y);
    return f ? !isLate(f) : true;
  };
  // NEW rule (rev 17): >=2 sprays, OR exactly 1 spray AFTER Aug 15.
  const isRealNew = (id: string, y: number): boolean => {
    const n = count(id, y);
    if (n >= 2) return true;
    if (n !== 1) return false;
    const f = firstOf(id, y);
    return f ? isLate(f) : false;
  };

  const hasTag = (id: string, t: string) => (tagsById.get(id) || []).includes(`${CY} - ${t}`);
  const isActive = (id: string) => statusById.get(id) === "active";
  // Spec's named continuation tags.
  const contTagNamed = (id: string) =>
    hasTag(id, "Auto") || hasTag(id, "SEB") || hasTag(id, "EB") || hasTag(id, "Renewed");
  // categorize.ts's full continuation set (adds Prepaid/Committed).
  const contTagFull = (id: string) => contTagNamed(id) || hasTag(id, "Prepaid") || hasTag(id, "Committed");

  const rate = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0");

  // ---- 1 + 2: rates ----
  for (const [label, isReal] of [
    ["OLD (rev16: >=1, single-late EXCLUDED)", isRealOld],
    ["NEW (rev17: >=2 OR single-late)", isRealNew],
  ] as const) {
    let d = 0;
    let n = 0;
    for (const id of ids) {
      if (!isReal(id, FROM)) continue;
      d++;
      if (isReal(id, CY)) n++;
    }
    console.log(`${label}: ${FROM}->${CY} = ${rate(n, d)}%  (${n} / ${d})  [sprays-only numerator]`);
  }

  // ---- NEW numerator with the tag path (rule 2) ----
  const returnedNew = (id: string) =>
    isRealNew(id, CY) || (contTagNamed(id) && isActive(id));
  const returnedNewFull = (id: string) =>
    isRealNew(id, CY) || (contTagFull(id) && isActive(id));
  let dNew = 0;
  let nNamed = 0;
  let nFull = 0;
  let viaSprayOnly = 0;
  let viaTagOnly = 0;
  let viaBoth = 0;
  for (const id of ids) {
    if (!isRealNew(id, FROM)) continue;
    dNew++;
    if (returnedNew(id)) nNamed++;
    if (returnedNewFull(id)) nFull++;
    const s = isRealNew(id, CY);
    const t = contTagNamed(id) && isActive(id);
    if (s && t) viaBoth++;
    else if (s) viaSprayOnly++;
    else if (t) viaTagOnly++;
  }
  console.log(
    `\nNEW combined numerator (spray OR named cont-tag+active): ${rate(nNamed, dNew)}%  (${nNamed} / ${dNew})`
  );
  console.log(
    `NEW combined numerator (spray OR FULL cont-tag+active):  ${rate(nFull, dNew)}%  (${nFull} / ${dNew})`
  );
  console.log(
    `  paths: spray-only ${viaSprayOnly} · tag-only ${viaTagOnly} · both ${viaBoth}`
  );

  // ---- 4: Prepaid/Committed-only ambiguity ----
  let prepaidCommittedOnly = 0;
  const samples: string[] = [];
  for (const id of ids) {
    if (contTagNamed(id)) continue;
    if (hasTag(id, "Prepaid") || hasTag(id, "Committed")) {
      prepaidCommittedOnly++;
      if (samples.length < 5) samples.push(`${id}:${(tagsById.get(id) || []).filter((t) => t.startsWith(`${CY} -`)).join("|")}`);
    }
  }
  console.log(
    `\nAMBIGUITY: cohort members with ${CY} Prepaid/Committed but NO Auto/SEB/EB/Renewed: ${prepaidCommittedOnly}`
  );
  if (samples.length) console.log(`  samples: ${samples.join("  ")}`);

  // ---- 3: Returning box old vs new ----
  let oldBox = 0;
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    const id = String(c.id);
    const tags = new Set(c.tags);
    const hasNew = tags.has(`${CY} - New Sale`);
    if (hasNew) continue;
    if (contTagFull(id)) oldBox++;
  }
  console.log(`\nReturning box OLD (active + ${CY} continuation tag, no New Sale): ${oldBox}`);

  // NEW box = real customer of FROM (rule 1) AND returned (rule 2).
  const newBox = new Set<string>();
  for (const id of ids) if (isRealNew(id, FROM) && returnedNew(id)) newBox.add(id);
  console.log(`Returning box NEW (prior-year real AND returned): ${newBox.size}`);

  // Sub-counts for the new box (tag precedence, then spray-history fallback).
  let auto = 0;
  let seb = 0;
  let eb = 0;
  let renewed = 0;
  let bySpray = 0;
  let other = 0;
  for (const id of newBox) {
    const tagPath = contTagNamed(id) && isActive(id);
    if (tagPath) {
      if (hasTag(id, "Auto")) auto++;
      else if (hasTag(id, "SEB")) seb++;
      else if (hasTag(id, "EB")) eb++;
      else if (hasTag(id, "Renewed")) renewed++;
      else other++;
    } else bySpray++;
  }
  console.log(
    `  sub-counts: Auto ${auto} · SEB ${seb} · EB ${eb} · Renewed ${renewed} · by spray history ${bySpray} · other ${other}`
  );
  console.log(`  sum check: ${auto + seb + eb + renewed + bySpray + other} vs box ${newBox.size}`);

  // ---- 5: numerator vs box diff ----
  const numer = new Set<string>();
  for (const id of ids) if (isRealNew(id, FROM) && returnedNew(id)) numer.add(id);
  const inBoxNotNum = [...newBox].filter((id) => !numer.has(id)).length;
  const inNumNotBox = [...numer].filter((id) => !newBox.has(id)).length;
  console.log(`\nBox vs numerator: box-not-numerator ${inBoxNotNum} · numerator-not-box ${inNumNotBox}`);

  // Status mix of the new box (how many are NOT currently active).
  let boxActive = 0;
  let boxNonActive = 0;
  for (const id of newBox) (isActive(id) ? boxActive++ : boxNonActive++);
  console.log(`Box status mix: active ${boxActive} · non-active ${boxNonActive}`);

  console.log(`\ncoverage: ${data.scraped.size} scraped / ${ids.length} cohort · tableOk ${data.tableOk.size}`);
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
