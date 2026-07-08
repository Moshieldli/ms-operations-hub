/**
 * READ-ONLY: locate the customer route CODE (user: "Routing" heading, field
 * "Code", e.g. WF2). customer-information 404s — profile is service-information.
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-route-code.ts
 */
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { sql } from "../src/lib/db";

const strip = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const isNav = (region: string) => /submenu|menu-text|dropdown-toggle/i.test(region.slice(0, 120));

(async () => {
  const rows = (await sql`
    SELECT pocomos_id, full_name FROM mosquito_service_status ORDER BY random() LIMIT 3
  `) as Array<{ pocomos_id: string; full_name: string }>;

  for (const r of rows) {
    const id = r.pocomos_id;
    for (const page of ["service-information", "edit", ""]) {
      const path = page ? `/customer/${id}/${page}` : `/customer/${id}`;
      let html: string;
      try {
        html = await getSessionedHtml(path);
      } catch (e) {
        console.log(`[${id}] ${path}: ERROR ${(e as Error).message.slice(0, 60)}`);
        continue;
      }
      // All "Routing" occurrences, skip the nav one.
      let printed = false;
      for (const m of html.matchAll(/Routing/gi)) {
        const region = html.slice(m.index!, m.index! + 700);
        if (isNav(region)) continue;
        console.log(`\n[${id}] ${path} — non-nav "Routing" @${m.index}:`);
        console.log("  " + strip(region));
        printed = true;
      }
      // Label "Code" in a dt/dd, td, or label — grab the following value.
      for (const m of html.matchAll(/(?:<(?:dt|td|label|th|strong|b)[^>]*>\s*(?:Route\s*)?Code\s*<\/(?:dt|td|label|th|strong|b)>)([\s\S]{0,160})/gi)) {
        console.log(`\n[${id}] ${path} — "Code" label + next: "${strip(m[0]).slice(0, 160)}"`);
        printed = true;
      }
      // Any short token that looks like a route code (WF2-style) near "route".
      for (const m of html.matchAll(/route[^<]{0,40}?([A-Z]{1,3}\d{1,3})\b/gi)) {
        console.log(`[${id}] ${path} — route-ish token: "${strip(m[0]).slice(0, 60)}"`);
        printed = true;
      }
      if (printed) break; // found something on this page; skip the other paths
    }
  }
  console.log("\n=== probe-route-code done ===");
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
