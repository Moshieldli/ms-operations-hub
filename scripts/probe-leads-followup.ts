/**
 * PROBE 1 (READ-ONLY) for /leads/followup: how many OPEN leads created this year
 * (the per-lead scrape cost), and what the bulk feed gives us for free.
 *
 * Uses the established /leads/data read feed (legacy DataTables 1.9 body — see
 * leadSync.ts::fetchLeadsPage and the documented gotchas). GET + DataTables-read
 * POST only; no actions.
 */
import { postSessioned } from "../src/lib/pocomos/webSession";
import { CURRENT_YEAR } from "../src/lib/pocomos";

const LEADS_COLUMNS = ["name_with_company","address","phone","map_code","status","date_added","salesperson","note","function"] as const;
const PAGE = 200;

function legacyBody(start: number): URLSearchParams {
  const b = new URLSearchParams();
  b.set("sEcho", "1");
  b.set("iColumns", String(LEADS_COLUMNS.length));
  b.set("sColumns", LEADS_COLUMNS.join(","));
  b.set("iDisplayStart", String(start));
  b.set("iDisplayLength", String(PAGE));
  LEADS_COLUMNS.forEach((c, i) => {
    b.set(`mDataProp_${i}`, c);
    b.set(`sSearch_${i}`, "");
    b.set(`bRegex_${i}`, "false");
    b.set(`bSearchable_${i}`, "true");
    b.set(`bSortable_${i}`, "true");
  });
  b.set("sSearch", "");
  b.set("bRegex", "false");
  b.set("iSortCol_0", String(LEADS_COLUMNS.indexOf("date_added")));
  b.set("sSortDir_0", "desc");
  b.set("iSortingCols", "1");
  return b;
}

(async () => {
  const first = await postSessioned<any>("/leads/data", legacyBody(0));
  console.log(`iTotalRecords=${first.iTotalRecords} iTotalDisplayRecords=${first.iTotalDisplayRecords}`);
  const sample = (first.aaData || [])[0];
  console.log(`\nrow keys: ${Object.keys(sample || {}).join(", ")}`);
  console.log(`sample row: ${JSON.stringify(sample).slice(0, 400)}`);

  // Walk every page and tally.
  const total = Number(first.iTotalRecords || 0);
  const rows: any[] = [...(first.aaData || [])];
  for (let s = PAGE; s < total; s += PAGE) {
    const p = await postSessioned<any>("/leads/data", legacyBody(s));
    rows.push(...(p.aaData || []));
  }
  console.log(`\nfetched ${rows.length} rows in ${Math.ceil(total / PAGE)} pages`);

  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(String(r.status ?? "?"), (byStatus.get(String(r.status ?? "?")) || 0) + 1);
  console.log(`\nby status (ALL years):`);
  for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

  const yearOf = (s: unknown) => String(s || "").match(/(\d{4})/)?.[1] ?? "?";
  const byYear = new Map<string, number>();
  for (const r of rows) byYear.set(yearOf(r.date_added), (byYear.get(yearOf(r.date_added)) || 0) + 1);
  console.log(`\nby created year (ALL statuses):`);
  for (const [k, v] of [...byYear.entries()].sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);

  // THE COST NUMBER: open "Lead" status, created this year.
  const scope = rows.filter(
    (r) => String(r.status || "").trim().toLowerCase() === "lead" && yearOf(r.date_added) === CURRENT_YEAR
  );
  console.log(`\n>>> SCOPE (status=Lead AND created ${CURRENT_YEAR}): ${scope.length} leads  <<<`);
  console.log(`    (this is the per-lead message-board scrape cost)`);
  console.log(`\nmarketing_type present on scope rows: ${scope.filter((r) => r.marketing_type_name).length}/${scope.length}`);
  console.log(`salesperson present: ${scope.filter((r) => r.salesperson).length}/${scope.length}`);
  console.log(`sample scope row: ${JSON.stringify(scope[0]).slice(0, 400)}`);
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
