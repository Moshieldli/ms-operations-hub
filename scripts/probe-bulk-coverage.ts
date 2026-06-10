/**
 * READ-ONLY: quantify how well /customers/data column 8 ("Last Service") can
 * replace the per-page service-history scrape.
 *
 *  - Pull ALL /customers/data pages (legacy 1.9, 200/page) → map id -> {lastService, multi}.
 *  - Intersect with the eligible active-mosquito set from the dataset.
 *  - For each eligible customer determine, from the dataset's own contracts,
 *    whether their ONLY active contract is mosquito (single) or they also have a
 *    non-mosquito active contract (add-on / multi).
 *  - Report: how many eligible are single-mosquito (bulk date authoritative) vs
 *    multi (still need a targeted scrape), plus overdue counts from the bulk date.
 */
import { getDataset } from "../src/lib/pocomos";
import { postSessioned } from "../src/lib/pocomos/webSession";
import { selectEligible, activeMosquitoContract, isMosquitoServiceType } from "../src/lib/service/mosquito";

const PAGE = 200;

function parseUs(d: string): Date | null {
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

async function fetchPage(start: number): Promise<Record<string, unknown>[]> {
  const cols = 11;
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(cols));
  body.set("sColumns", ",".repeat(cols - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE));
  for (let i = 0; i < cols; i++) body.set(`mDataProp_${i}`, String(i));
  body.set("iSortingCols", "0");
  const resp = await postSessioned<Record<string, unknown>>("/customers/data", body, { referer: "/customers/" });
  return (resp.aaData as Record<string, unknown>[]) || [];
}

(async () => {
  const ds = await getDataset({ force: true });
  const eligible = selectEligible(ds.customers);
  const eligibleSet = new Map(eligible.map((e) => [e.id, e]));
  console.log(`eligible active-mosquito: ${eligible.length}`);

  // single vs multi from dataset contracts (active non-mosquito contract present?)
  const byId = new Map(ds.customers.map((c) => [String(c.id), c]));
  let single = 0, multi = 0;
  for (const e of eligible) {
    const cust = byId.get(e.id);
    if (!cust) continue;
    const activeNonMosq = cust.contracts.some(
      (k) => String(k.status).toLowerCase() === "active" && !isMosquitoServiceType(k.serviceType)
    );
    if (activeNonMosq) multi++; else single++;
  }
  console.log(`  single mosquito-only (bulk date = mosquito): ${single}`);
  console.log(`  multi / has add-on active contract (needs scrape): ${multi}  (${((multi / eligible.length) * 100).toFixed(1)}%)`);

  // Pull all /customers/data
  const lastSvc = new Map<string, { date: Date | null; raw: string; multi: number }>();
  let pages = 0;
  for (let start = 0; ; start += PAGE) {
    const rows = await fetchPage(start);
    pages++;
    for (const r of rows) {
      lastSvc.set(String(r.id), {
        date: parseUs(String(r["8"] ?? "")),
        raw: String(r["8"] ?? ""),
        multi: Number(r.multiple_contracts ?? 0),
      });
    }
    if (rows.length < PAGE) break;
    if (pages > 20) break;
  }
  console.log(`\n/customers/data pulled in ${pages} pages; ${lastSvc.size} customer rows`);

  // Coverage + overdue from bulk date for the SINGLE-contract eligible set.
  const now = new Date();
  let covered = 0, missing = 0, overdueBulk = 0, currentBulk = 0, noDate = 0;
  for (const e of eligible) {
    const cust = byId.get(e.id);
    const activeNonMosq = cust?.contracts.some(
      (k) => String(k.status).toLowerCase() === "active" && !isMosquitoServiceType(k.serviceType)
    );
    if (activeNonMosq) continue; // single-contract only for this accuracy check
    const rec = lastSvc.get(e.id);
    if (!rec) { missing++; continue; }
    covered++;
    if (!rec.date) { noDate++; continue; }
    const days = Math.floor((now.getTime() - rec.date.getTime()) / 86_400_000);
    if (days > 15) overdueBulk++; else currentBulk++;
  }
  console.log(`\nSINGLE mosquito-only eligible — bulk "Last Service" coverage:`);
  console.log(`  matched in /customers/data: ${covered}, missing: ${missing}, no-date: ${noDate}`);
  console.log(`  bulk verdict → overdue(>15d): ${overdueBulk}, current(<=15d): ${currentBulk}`);
  console.log(`\nso a full refresh = ${pages} bulk calls + ${multi} per-page scrapes (vs ${eligible.length} today)`);
  console.log("=== done ===");
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
