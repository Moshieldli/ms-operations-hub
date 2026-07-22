import { getMasterRoutingSchedule } from "../src/lib/service/masterRouting";
(async () => {
  const dates: string[] = [];
  const d = new Date(Date.UTC(2026, 4, 1)); // May 1
  while (d < new Date(Date.UTC(2026, 7, 1))) { // Aug 1
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const t0 = Date.now();
  const sheet = await getMasterRoutingSchedule(dates);
  console.log(`fetched+parsed in ${Date.now() - t0}ms; days: ${sheet?.size ?? "null"}`);
  if (!sheet) return;
  for (const [date, sd] of [...sheet.entries()].sort()) {
    for (const r of sd.rows) {
      if (/ANT/i.test(r.daycode)) console.log(`ANT: ${date} ${r.tech} code=${JSON.stringify(r.daycode)} stops=${r.stops}`);
      else if (/WF|WG|RLW|TKO|ASAP|TRN/i.test(r.daycode)) console.log(`SPECIAL: ${date} ${r.tech} code=${JSON.stringify(r.daycode)}`);
    }
    if (sd.note) console.log(`NOTE: ${date} ${JSON.stringify(sd.note)}`);
  }
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
