/**
 * READ-ONLY probe: is there a BULK source for last-mosquito-spray date, so we
 * can stop scraping ~1,100 /customer/{id}/service-history pages?
 *
 * Three parts (all GET / read-only — never mutates Pocomos):
 *   1. CONTRACT OBJECT — full raw JSON of contracts for ~5 active mosquito
 *      customers via JWT /customer/{id}/contracts. Hunt for any per-contract
 *      last-service/next-service/last-job date field.
 *   2. WEB /customers/data — discover the DataTables columns from the /customers
 *      HTML, pull one page via postSessioned (legacy 1.9 body), dump the full
 *      field set of one row + total count + pagination math.
 *   3. Verdict printed by the operator from the dumps.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-bulk-spray-date.ts
 */
import { getJson } from "../src/lib/pocomos/client";
import { getDataset } from "../src/lib/pocomos";
import { selectEligible } from "../src/lib/service/mosquito";
import { postSessioned, getSessionedHtml } from "../src/lib/pocomos/webSession";

const OFFICE = process.env.POCOMOS_OFFICE || "1512";

// Keys that would represent a "last service / next service / recent job" date.
const DATE_KEY_RE =
  /(last|recent|prev|next|latest).*(service|job|visit|spray|complete|appt|appointment|date)|(\bdate\b.*(service|job|visit))|service.?date|job.?date/i;

function findDateishKeys(obj: unknown, path = "", out: Array<{ path: string; value: unknown }> = []) {
  if (obj == null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    const looksDateKey = DATE_KEY_RE.test(k) || /date|_at$|_on$/i.test(k);
    if (looksDateKey && (v == null || typeof v !== "object")) {
      out.push({ path: p, value: v });
    }
    if (v && typeof v === "object") findDateishKeys(v, p, out);
  }
  return out;
}

function topKeys(obj: unknown): string[] {
  return obj && typeof obj === "object" ? Object.keys(obj as object) : [];
}

async function part1Contracts(ids: string[]) {
  console.log("\n========== PART 1: JWT /customer/{id}/contracts raw dump ==========");
  for (const id of ids) {
    console.log(`\n----- customer ${id} -----`);
    let raw: unknown;
    try {
      raw = await getJson<unknown>(`/jwt/pronexis/${OFFICE}/customer/${id}/contracts`);
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`);
      continue;
    }
    const arr =
      raw && typeof raw === "object" && Array.isArray((raw as { response?: unknown[] }).response)
        ? ((raw as { response: unknown[] }).response as unknown[])
        : Array.isArray(raw)
        ? (raw as unknown[])
        : [];
    console.log(`  contracts: ${arr.length}`);
    arr.forEach((c, i) => {
      const top = topKeys(c);
      const pc = (c as Record<string, unknown>).pest_contract;
      console.log(`  [contract ${i}] top-level keys: ${top.join(", ")}`);
      console.log(
        `    status=${JSON.stringify((c as Record<string, unknown>).status)} ` +
          `service_type=${JSON.stringify((pc as Record<string, unknown>)?.service_type)}`
      );
      console.log(`    pest_contract keys: ${topKeys(pc).join(", ")}`);
      const dateish = findDateishKeys(c);
      console.log(
        `    date-ish fields (path = value):\n` +
          dateish.map((d) => `      ${d.path} = ${JSON.stringify(d.value)}`).join("\n")
      );
    });
    // Full raw for the FIRST customer only — so we can eyeball the entire shape.
    if (id === ids[0]) {
      console.log(`\n  >>> FULL RAW JSON for ${id} (first eligible customer):`);
      console.log(JSON.stringify(arr, null, 2));
    }
  }
}

async function discoverCustomersColumns(): Promise<{
  endpoint: string;
  columns: string[];
}> {
  console.log("\n========== PART 2a: discover /customers DataTables config ==========");
  let html = "";
  for (const path of ["/customers", "/customers/", "/customer"]) {
    try {
      html = await getSessionedHtml(path);
      if (html && html.length > 500) {
        console.log(`  fetched ${path} (${html.length} bytes)`);
        break;
      }
    } catch (e) {
      console.log(`  ${path}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  // ajax source
  const ajax =
    html.match(/sAjaxSource"?\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    html.match(/ajax"?\s*[:=]\s*["']([^"']*customers?\/data[^"']*)["']/i)?.[1] ||
    "/customers/data";
  // column field names: aoColumns/columns with mData/mDataProp/data
  const cols: string[] = [];
  for (const m of html.matchAll(/"?(?:mDataProp|mData|data)"?\s*:\s*"([a-z0-9_.]+)"/gi)) {
    if (!cols.includes(m[1])) cols.push(m[1]);
  }
  console.log(`  ajax source: ${ajax}`);
  console.log(`  discovered columns (${cols.length}): ${cols.join(", ") || "(none — will use fallback)"}`);
  return { endpoint: ajax.startsWith("http") ? new URL(ajax).pathname : ajax, columns: cols };
}

async function part2CustomersData(disc: { endpoint: string; columns: string[] }) {
  console.log("\n========== PART 2b: POST /customers/data (legacy 1.9) ==========");
  // Fallback column guess if discovery found nothing — common Pocomos customer cols.
  const columns =
    disc.columns.length > 0
      ? disc.columns
      : [
          "name",
          "address",
          "phone",
          "email",
          "status",
          "last_service_date",
          "next_service_date",
          "salesperson",
          "function",
        ];
  const PAGE_SIZE = 100;
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(columns.length));
  body.set("sColumns", ",".repeat(columns.length - 1));
  body.set("iDisplayStart", "0");
  body.set("iDisplayLength", String(PAGE_SIZE));
  for (let i = 0; i < columns.length; i++) {
    body.set(`mDataProp_${i}`, columns[i]);
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortingCols", "0");

  let resp: Record<string, unknown>;
  try {
    resp = await postSessioned<Record<string, unknown>>(disc.endpoint, body, {
      referer: "/customers/",
    });
  } catch (e) {
    console.log(`  POST ${disc.endpoint} ERROR: ${(e as Error).message}`);
    return;
  }
  const rows =
    (resp.aaData as unknown[]) || (resp.data as unknown[]) || [];
  const total = resp.iTotalRecords ?? resp.recordsTotal ?? resp.iTotalDisplayRecords;
  console.log(`  iTotalRecords=${total} rows_this_page=${rows.length}`);
  console.log(`  response top-level keys: ${topKeys(resp).join(", ")}`);
  if (rows.length === 0) {
    console.log("  NO ROWS — dumping raw response (first 1500 chars):");
    console.log(JSON.stringify(resp).slice(0, 1500));
    return;
  }
  const first = rows[0] as Record<string, unknown>;
  console.log(`\n  >>> FULL FIELD SET of row[0] (${topKeys(first).length} keys):`);
  console.log(JSON.stringify(first, null, 2));
  // Highlight date-ish fields across first 3 rows
  console.log(`\n  date-ish fields in first up-to-3 rows:`);
  rows.slice(0, 3).forEach((r, i) => {
    const dateish = findDateishKeys(r);
    console.log(`   row[${i}]: ${dateish.map((d) => `${d.path}=${JSON.stringify(d.value)}`).join(" | ")}`);
  });
  if (typeof total === "number") {
    console.log(
      `\n  pagination: ${total} customers / ${PAGE_SIZE} per page = ${Math.ceil(
        total / PAGE_SIZE
      )} calls (at 200/page = ${Math.ceil(total / 200)} calls)`
    );
  }
}

(async () => {
  console.log("Building dataset (force) to pick eligible mosquito customers…");
  const ds = await getDataset({ force: true });
  const eligible = selectEligible(ds.customers);
  console.log(`eligible active mosquito customers: ${eligible.length}`);
  const sampleIds = eligible.slice(0, 5).map((e) => e.id);
  console.log(`sampling: ${sampleIds.join(", ")}`);

  await part1Contracts(sampleIds);

  const disc = await discoverCustomersColumns();
  await part2CustomersData(disc);

  console.log("\n=== probe complete ===");
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
