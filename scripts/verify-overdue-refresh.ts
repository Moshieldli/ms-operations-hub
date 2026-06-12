import { refreshMosquitoStatus, getOverdueReport } from "../src/lib/service/refresh";
(async()=>{
  console.log("running full refresh (READ-ONLY against Pocomos)...");
  const meta = await refreshMosquitoStatus({ forceDataset: true, budgetMs: 280_000 });
  console.log("\n=== RefreshMeta ===");
  console.log(JSON.stringify(meta, null, 2));
  const r = await getOverdueReport();
  console.log("\n=== Report counts ===");
  console.log(JSON.stringify(r.counts, null, 2));
  console.log("paused sample:", r.pausedBalance.slice(0,5).map(x=>`${x.full_name} $${x.open_balance} signup=${x.sign_up_date}`));
  console.log("overdue sample:", r.overdue.slice(0,3).map(x=>`${x.full_name} days=${x.days_since} signup=${x.sign_up_date}`));
})().catch(e=>{console.error("FAILED:",e);process.exit(1);});
