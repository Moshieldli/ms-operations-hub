/**
 * One-off: scan a batch of recent leads, count notes per lead via the same
 * `getNotesForLead` path leadSync uses, print the top N by note count so we
 * can pick a real lead to test the >10 notes cap on.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/find-noteworthy-leads.ts [pageSize] [maxConcurrent]
 *
 * Defaults: pageSize=100, maxConcurrent=5.
 */
import { postSessioned } from "../src/lib/pocomos/webSession";
import { getNotesForLead, getNotesForCustomer } from "../src/lib/pocomos/notes";

const PROBE_TARGET = (process.argv[5] || "leads").toLowerCase(); // "leads" | "customers"

const PAGE_SIZE = Number(process.argv[2] || 100);
const CONCURRENCY = Number(process.argv[3] || 5);
const PAGES_TO_SCAN = Number(process.argv[4] || 1);

interface LeadRow {
  id?: string | number;
  lead_id?: string | number;
  first_name?: string;
  last_name?: string;
  name?: string;
  date_added?: string;
}

interface LeadsDataResponse {
  aaData?: LeadRow[];
  data?: LeadRow[];
  iTotalRecords?: number;
}

function leadIdOf(row: LeadRow): string {
  const v = row.id ?? row.lead_id ?? "";
  return typeof v === "number" ? String(v) : v;
}

function nameOf(row: LeadRow): string {
  const first = row.first_name || "";
  const last = row.last_name || "";
  if (first || last) return `${first} ${last}`.trim();
  return row.name || "(no name)";
}

async function fetchPage(start: number): Promise<{ rows: LeadRow[]; total: number }> {
  const body = new URLSearchParams();
  body.set("draw", "1");
  body.set("sEcho", "1");
  // Send BOTH the modern (start/length) and legacy 1.9 (iDisplayStart/iDisplayLength)
  // pagination keys — Pocomos's endpoint appears to ignore `start` alone.
  body.set("start", String(start));
  body.set("length", String(PAGE_SIZE));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
  if (PROBE_TARGET === "customers") {
    body.append("statuses[]", "Inactive");
    body.append("statuses[]", "On-Hold");
  } else {
    body.append("statuses[]", "Lead");
    body.append("statuses[]", "Not Home");
    body.append("statuses[]", "Not Interested");
    body.append("statuses[]", "Monitor");
  }
  body.set("search[value]", "");
  body.set("search[regex]", "false");
  body.set("order[0][column]", "0");
  body.set("order[0][dir]", "desc");
  const path = PROBE_TARGET === "customers" ? "/customers/data" : "/leads/data";
  const referer = PROBE_TARGET === "customers" ? "/customers" : "/leads";
  const resp = await postSessioned<LeadsDataResponse>(path, body, { referer });
  return { rows: resp.aaData ?? resp.data ?? [], total: resp.iTotalRecords ?? 0 };
}

(async () => {
  console.log(
    `Scanning ${PAGES_TO_SCAN} page(s) of ${PAGE_SIZE} leads each (any open status), concurrency=${CONCURRENCY}...\n`
  );
  const allRows: LeadRow[] = [];
  let total = 0;
  for (let p = 0; p < PAGES_TO_SCAN; p++) {
    const { rows, total: t } = await fetchPage(p * PAGE_SIZE);
    if (p === 0) {
      total = t;
      console.log(`iTotalRecords=${t}, first page returned ${rows.length} rows`);
    } else {
      console.log(`page ${p + 1}: ${rows.length} rows`);
    }
    if (rows.length === 0) break;
    allRows.push(...rows);
  }
  const rows = allRows;
  console.log(`\nProbing notes for ${rows.length} leads (of ${total} total)...\n`);

  const results: Array<{ id: string; name: string; dateAdded: string; count: number }> = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const row = rows[idx];
      const id = leadIdOf(row);
      if (!id) continue;
      try {
        const notes =
          PROBE_TARGET === "customers"
            ? await getNotesForCustomer(id)
            : await getNotesForLead(id);
        results.push({ id, name: nameOf(row), dateAdded: row.date_added || "", count: notes.length });
      } catch (e) {
        results.push({ id, name: nameOf(row), dateAdded: row.date_added || "", count: -1 });
        console.warn(`  ${id} errored: ${(e as Error).message.slice(0, 100)}`);
      }
      done++;
      if (done % 10 === 0) console.log(`  progress: ${done}/${rows.length}`);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker);
  await Promise.all(workers);

  results.sort((a, b) => b.count - a.count);

  console.log(`\n=== Top 15 leads by note count ===`);
  for (const r of results.slice(0, 15)) {
    console.log(
      `  ${String(r.count).padStart(3)} notes  id=${r.id.padEnd(10)}  ${r.name.padEnd(30)}  added=${r.dateAdded}`
    );
  }

  const overTen = results.filter((r) => r.count >= 11);
  console.log(`\n${overTen.length} leads have 11+ notes (would exercise the cap+tail format)`);
  if (overTen.length === 0) {
    console.log(`Best candidate has only ${results[0]?.count ?? 0} notes — try a bigger pageSize.`);
  }
})().catch((e) => {
  console.error("find-noteworthy-leads failed:", e);
  process.exitCode = 1;
});
