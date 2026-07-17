/** Verify rev 19: new returned-rule, bucket partition, anomalies card. */
import { getSalesTaxonomy } from "../src/lib/sales-taxonomy";
(async () => {
  const t = await getSalesTaxonomy();
  const rr = t.returnRates, box = t.returningBox, sb = t.seasonBuckets, an = t.anomalies;
  for (const p of rr.pairs)
    console.log(`${p.fromYear}→${p.toYear}: ${p.reliable ? `${p.rate.toFixed(1)}% (${p.returned}/${p.realFrom}) · tag ${p.returnedByTag} / sprays ${p.returnedBySprayHistory}` : "n/a"}`);

  console.log(`\nRETURNING BOX: ${box.total}`);
  console.log(`   Auto ${box.auto} · SEB ${box.seb} · EB ${box.eb} · Renewed ${box.renewed} · New Sale ${box.newSale} · spray/other ${box.bySprayHistory}`);
  console.log(`   sum=${box.auto+box.seb+box.eb+box.renewed+box.newSale+box.bySprayHistory} · activeTagged ${box.activeTagged} · churned ${box.churnedReturners} · priorYearReal ${box.priorYearReal}`);

  console.log(`\nSEASON BUCKETS (partition of active+${t.year}-tagged):`);
  console.log(`   New ${sb.newCount} + Season-Skipped ${sb.seasonSkipped} + Returning(active) ${sb.returningActive} = ${sb.newCount + sb.seasonSkipped + sb.returningActive}`);
  console.log(`   Active customers (active + ${t.year} tag) = ${sb.activeTagged}`);
  console.log(`   Returning total ${sb.returningTotal} = active ${sb.returningActive} + churned ${sb.churnedReturners}`);

  console.log(`\nANOMALIES: ${an.total}`);
  for (const c of an.classes) console.log(`   ${String(c.count).padStart(4)}  ${c.label}`);
  console.log(`\n   samples:`);
  for (const c of an.classes) {
    const first = an.items.find((i) => i.classKey === c.key);
    if (first) console.log(`   [${c.key}] ${first.name} (${first.id}) — ${first.reason.slice(0, 110)}`);
  }

  const checks: [string, boolean][] = [
    ["partition balances (New+Skipped+Returning(active) === Active)", sb.newCount + sb.seasonSkipped + sb.returningActive === sb.activeTagged],
    ["box.total === returningActive + churned", box.total === sb.returningActive + sb.churnedReturners],
    ["box sub-counts sum to total", box.auto+box.seb+box.eb+box.renewed+box.newSale+box.bySprayHistory === box.total],
    ["box.total === CY numerator", box.total === rr.pairs.find((p) => p.toYear === t.year)!.returned],
    ["both pairs reliable", rr.pairs.every((p) => p.reliable)],
    ["anomaly count === items length", an.total === an.items.length],
  ];
  console.log("");
  let ok = true;
  for (const [n, p] of checks) { console.log(`${p ? "PASS" : "FAIL"}  ${n}`); if (!p) ok = false; }
  console.log(ok ? "\nALL INVARIANTS HOLD" : "\nINVARIANT VIOLATION");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
