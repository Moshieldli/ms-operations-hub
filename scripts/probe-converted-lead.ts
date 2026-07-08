/**
 * READ-ONLY. Try every reachable path for the two lead rows and dump them:
 *   5641361 — Igor's converted lead, status "Customer"
 *   5505704 — the duplicate, status "Lead"
 * Goal: does the converted-lead row reference the customer it became?
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-converted-lead.ts
 */
import { postSessioned } from "../src/lib/pocomos/webSession";
import { getJson, pocomosOffice } from "../src/lib/pocomos";

const PAGE_SIZE = 200;
const LEADS_COLUMNS = [
  "name_with_company", "address", "phone", "map_code", "status",
  "date_added", "salesperson", "note", "function",
] as const;
const DATE_ADDED_COL_INDEX = LEADS_COLUMNS.indexOf("date_added");
const TARGETS = ["5641361", "5505704"];

interface LeadsDataResponse {
  aaData?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  iTotalRecords?: number;
  type?: string;
  redirect?: string;
}

async function fetchPage(start: number, statuses: string[]): Promise<LeadsDataResponse> {
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(LEADS_COLUMNS.length));
  body.set("sColumns", ",".repeat(LEADS_COLUMNS.length - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  for (let i = 0; i < LEADS_COLUMNS.length; i++) {
    body.set(`mDataProp_${i}`, LEADS_COLUMNS[i]);
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, i === LEADS_COLUMNS.length - 1 ? "false" : "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortCol_0", String(DATE_ADDED_COL_INDEX));
  body.set("sSortDir_0", "desc");
  body.set("iSortingCols", "1");
  for (const s of statuses) body.append("statuses[]", s);
  body.set("salesperson", "");
  return postSessioned<LeadsDataResponse>("/leads/data", body, { referer: "/leads/" });
}

function idOf(row: Record<string, unknown>): string {
  return String((row.id ?? row.lead_id ?? "") as string | number);
}

const fromLeadsData: Record<string, Record<string, unknown>> = {};

async function sweep(statuses: string[]) {
  let start = 0;
  let total: number | null = null;
  let fetched = 0;
  for (let p = 0; p < 400; p++) {
    const page = await fetchPage(start, statuses);
    if (page.type === "redirect") { console.log(`  [${statuses.join("/")}] redirect ${page.redirect}`); return; }
    if (total == null) total = page.iTotalRecords ?? null;
    const rows = page.aaData ?? page.data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      fetched++;
      const id = idOf(row);
      if (TARGETS.includes(id)) fromLeadsData[id] = row;
    }
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  console.log(`  /leads/data statuses=[${statuses.join(",")}] total=${total} fetched=${fetched} found=[${Object.keys(fromLeadsData).join(",")||"none"}]`);
}

(async () => {
  console.log("--- /leads/data sweeps (all pipeline statuses) ---");
  const STATUSES = ["Lead", "Not Home", "Not Interested", "Monitor", "Do Not Knock",
    "Sold", "Converted", "Customer", "Inactive", "Cancelled", "Dead"];
  for (const s of STATUSES) {
    await sweep([s]);
    if (TARGETS.every((t) => fromLeadsData[t])) break;
  }

  console.log("\n--- JWT lead detail (GET, read-only) ground truth ---");
  const jwtRows: Record<string, unknown> = {};
  for (const id of TARGETS) {
    try {
      const detail = await getJson<unknown>(`/jwt/${pocomosOffice()}/lead/${id}`);
      jwtRows[id] = (detail as { response?: unknown }).response ?? detail;
    } catch (e) {
      jwtRows[id] = `ERROR ${(e as Error).message}`;
    }
  }

  for (const target of TARGETS) {
    console.log(`\n===== /leads/data ROW — lead ${target} =====`);
    console.log(fromLeadsData[target] ? JSON.stringify(fromLeadsData[target], null, 2) : "NOT PRESENT in /leads/data for any status");
    console.log(`----- JWT /lead/${target} detail (for comparison) -----`);
    console.log(JSON.stringify(jwtRows[target], null, 2));
  }
})();
