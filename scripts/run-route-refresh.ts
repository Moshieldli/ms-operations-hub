/**
 * One-off: run the full mosquito refresh with forceRoutes to populate route_code
 * for every eligible customer and measure the route-scrape time. READ-ONLY
 * against Pocomos (GET service-information); writes route_code to Neon.
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-route-refresh.ts
 */
import { refreshMosquitoStatus, getOverdueReport } from "../src/lib/service/refresh";

(async () => {
  const t0 = Date.now();
  const meta = await refreshMosquitoStatus({ budgetMs: 520_000, forceRoutes: true });
  console.log("REFRESH META:", JSON.stringify(meta, null, 2));
  console.log(`\nTOTAL wall: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(
    `ROUTE phase: scraped=${meta.routesScraped} found=${meta.routesFound} failed=${meta.routesFailed} pending=${meta.routesPending} in ${(meta.routeDurationMs / 1000).toFixed(1)}s`
  );

  const report = await getOverdueReport();
  const withRoute = [...report.overdue, ...report.scheduledToday, ...report.pausedBalance, ...report.needsCheck].filter(
    (r) => r.route_code
  );
  console.log(`\nrows with a route_code: ${withRoute.length}`);
  console.log("sample:", withRoute.slice(0, 8).map((r) => `${r.full_name}=${r.route_code}`).join(" | "));
})().catch((e) => {
  console.error("RUN FAILED:", e);
  process.exit(1);
});
