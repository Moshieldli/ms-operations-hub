/** Fill respray_jobs + print the per-tech YTD table. READ-ONLY against Pocomos.
 *  node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-resprays.ts */
import { refreshResprays, getRespraysReport } from "../src/lib/service/resprays";
(async () => {
  const meta = await refreshResprays();
  console.log(`parsed ${meta.rowsParsed} rows · stored ${meta.mosquitoJobsStored} mosquito jobs · ${(meta.durationMs/1000).toFixed(1)}s`);
  const r = await getRespraysReport();
  const t = r.totals;
  console.log(`\nTOTALS ${r.year}: re-service jobs ${t.reserviceJobs} · counted resprays (<=10d) ${t.countedResprays} · excluded 11+d ${t.excludedGap} · unattributed ${t.unattributed}`);
  console.log(`applications ${t.applications} · team rate ${t.teamRate.toFixed(2)}%`);
  console.log(`\n${"TECH".padEnd(22)}${"APPS".padStart(6)}${"RESPRAYS".padStart(10)}${"RATE".padStart(8)}${"vsTEAM".padStart(9)}  FLAG`);
  for (const x of r.techs)
    console.log(`${x.technician.padEnd(22)}${String(x.applications).padStart(6)}${String(x.resprays).padStart(10)}${(x.rate.toFixed(2)+"%").padStart(8)}${(x.vsTeam.toFixed(2)+"x").padStart(9)}  ${x.flagged ? "FLAGGED" : ""}`);
  const sum = r.techs.reduce((s,x)=>s+x.resprays,0);
  console.log(`\ncheck: per-tech resprays sum ${sum} === counted ${t.countedResprays} → ${sum===t.countedResprays?"PASS":"FAIL"}`);
  const apps = r.techs.reduce((s,x)=>s+x.applications,0);
  console.log(`check: per-tech apps sum ${apps} === applications ${t.applications} → ${apps===t.applications?"PASS":"FAIL"}`);
  process.exit(0);
})().catch((e)=>{console.error("FAILED:",e);process.exit(1);});
