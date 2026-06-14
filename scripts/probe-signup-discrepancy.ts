/**
 * READ-ONLY probe (GET/POST-search only; mutates NOTHING in Pocomos).
 *
 * Investigates a sign-up-date discrepancy for two test customers:
 *   - Avram/Avraham Isakov  (dashboard sign-up 05/16/25)
 *   - Ashley Maiorano       (dashboard 05/27/22, Pocomos Edit shows 06/09/26)
 *
 * For each: (1) dump their FULL /customers/data bulk-grid row, every column with
 * index + value; (2) dump the FULL raw JSON of their mosquito contract from the
 * JWT contracts endpoint, identifying the per-contract "Date Signed Up" field.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-signup-discrepancy.ts
 */
import { getSessionedHtml, postSessioned } from "../src/lib/pocomos/webSession";
import { getJson, pocomosOffice } from "../src/lib/pocomos/client";
import { fetchAllCustomers } from "../src/lib/pocomos/customers";

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const COLS = 11; // grid is exactly 11 columns (0..10)

async function gridSearch(term: string): Promise<Record<string, unknown>[]> {
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(COLS));
  body.set("sColumns", ",".repeat(COLS - 1));
  body.set("iDisplayStart", "0");
  body.set("iDisplayLength", "100");
  for (let i = 0; i < COLS; i++) {
    body.set(`mDataProp_${i}`, String(i));
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, "true");
  }
  body.set("sSearch", term);
  body.set("bRegex", "false");
  body.set("iSortingCols", "0");
  const resp = await postSessioned<Record<string, unknown>>("/customers/data", body, {
    referer: "/customers/",
  });
  return (resp.aaData as Record<string, unknown>[]) || [];
}

function printGridRow(r: Record<string, unknown>) {
  for (let i = 0; i < COLS; i++) {
    console.log(`    [${i}] = "${stripTags(String(r[String(i)] ?? ""))}"`);
  }
  // appended named keys (not part of the positional 0..10)
  const named = Object.keys(r).filter((k) => !/^\d+$/.test(k));
  console.log(`    named keys: ${JSON.stringify(Object.fromEntries(named.map((k) => [k, r[k]])))}`);
}

// date-looking value: MM/DD/YY(YY) or YYYY-MM-DD or ISO
function looksLikeDate(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v);
}

function dumpDateFields(obj: Record<string, unknown>, label: string) {
  const hits: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (looksLikeDate(v) || /date|signed|start|end|renew|created|sign/i.test(k)) {
      if (typeof v !== "object" || v === null) hits.push(`      ${k} = ${JSON.stringify(v)}`);
    }
  }
  console.log(`    -- date-ish fields on ${label}:`);
  console.log(hits.length ? hits.join("\n") : "      (none)");
}

async function fetchContractsRaw(customerId: string | number): Promise<unknown[]> {
  const data = await getJson<{ response?: unknown[] }>(
    `/jwt/pronexis/${pocomosOffice()}/customer/${customerId}/contracts`
  );
  return Array.isArray(data.response) ? data.response : [];
}

async function investigate(displayName: string, searchTerms: string[], hintId?: string) {
  console.log(`\n\n================================================================`);
  console.log(`CUSTOMER: ${displayName}`);
  console.log(`================================================================`);

  // ---- 1. BULK GRID ----
  console.log(`\n--- 1. BULK GRID  POST /customers/data ---`);
  let rows: Record<string, unknown>[] = [];
  for (const term of searchTerms) {
    rows = await gridSearch(term);
    console.log(`  search "${term}" -> ${rows.length} row(s)`);
    if (rows.length) break;
  }
  // filter to likely matches by surname token
  const surname = searchTerms[0].split(/\s+/).pop()!.toLowerCase();
  const matches = rows.filter((r) =>
    (String(r["1"]) + " " + String(r["2"])).toLowerCase().includes(surname)
  );
  const useRows = matches.length ? matches : rows;
  const gridIds = new Set<string>();
  useRows.forEach((r, idx) => {
    console.log(`\n  ROW ${idx} (id=${r.id}):`);
    printGridRow(r);
    if (r.id != null) gridIds.add(String(r.id));
  });
  if (!useRows.length) console.log(`  !! no grid rows matched.`);

  // also confirm the JWT customer-list id by name match
  let listId: string | undefined;
  try {
    const all = await fetchAllCustomers();
    const sn = surname;
    const found = all.filter((c) => {
      const fn = String(c.firstName ?? "").toLowerCase();
      const ln = String(c.lastName ?? "").toLowerCase();
      return ln.includes(sn) || `${fn} ${ln}`.includes(sn);
    });
    console.log(`\n  JWT customer/list name matches for "${sn}": ${found.length}`);
    for (const c of found.slice(0, 6)) {
      console.log(
        `    id=${c.id} ${c.firstName} ${c.lastName} status=${c.status} customer_number=${c.customer_number ?? c.customerNumber ?? ""}`
      );
    }
    if (found.length === 1) listId = String(found[0].id);
  } catch (e) {
    console.log(`  (JWT list lookup failed: ${(e as Error).message})`);
  }

  // candidate ids to try for contracts
  const candidates = new Set<string>();
  if (hintId) candidates.add(hintId);
  if (listId) candidates.add(listId);
  for (const g of gridIds) candidates.add(g);

  // ---- 2. CONTRACTS ----
  console.log(`\n--- 2. CONTRACTS  GET /jwt/pronexis/${pocomosOffice()}/customer/{id}/contracts ---`);
  console.log(`  trying candidate customer ids: ${JSON.stringify([...candidates])}`);
  let contracts: unknown[] = [];
  let usedId: string | undefined;
  for (const cid of candidates) {
    try {
      const c = await fetchContractsRaw(cid);
      console.log(`    id ${cid} -> ${c.length} contract(s)`);
      if (c.length) {
        contracts = c;
        usedId = cid;
        break;
      }
    } catch (e) {
      console.log(`    id ${cid} -> ERROR ${(e as Error).message}`);
    }
  }

  if (!contracts.length) {
    console.log(`  !! no contracts retrieved for any candidate id.`);
    return;
  }

  console.log(`\n  contracts via id=${usedId}: ${contracts.length} total. service types:`);
  contracts.forEach((c, i) => {
    const cc = c as Record<string, any>;
    const st = cc?.pest_contract?.service_type?.name ?? cc?.pest_contract?.service_type ?? "(?)";
    console.log(
      `    [${i}] contract.id=${cc.id} status=${cc.status} pest_contract.id=${cc?.pest_contract?.id} service_type=${JSON.stringify(st)}`
    );
  });

  // pick the mosquito contract(s)
  const isMosq = (c: any) =>
    /mosquito/i.test(JSON.stringify(c?.pest_contract?.service_type ?? ""));
  const mosq = contracts.filter(isMosq);
  const dump = mosq.length ? mosq : contracts; // fall back to all if no mosquito match

  for (const c of dump) {
    const cc = c as Record<string, any>;
    console.log(`\n  ========== ${mosq.length ? "MOSQUITO" : "CONTRACT"} contract.id=${cc.id} ==========`);
    console.log(`  top-level keys: ${JSON.stringify(Object.keys(cc))}`);
    dumpDateFields(cc, `contract ${cc.id}`);
    if (cc.pest_contract && typeof cc.pest_contract === "object") {
      console.log(`    pest_contract keys: ${JSON.stringify(Object.keys(cc.pest_contract))}`);
      dumpDateFields(cc.pest_contract, `pest_contract`);
    }
    if (cc.profile && typeof cc.profile === "object") {
      dumpDateFields(cc.profile, `profile`);
    }
    console.log(`\n  FULL RAW JSON of contract.id=${cc.id}:`);
    console.log(JSON.stringify(cc, null, 2));
  }
}

(async () => {
  await investigate("Avram / Avraham Isakov  (dashboard sign-up 05/16/25)", [
    "Isakov",
  ]);
  await investigate(
    "Ashley Maiorano  (dashboard 05/27/22; Pocomos Edit shows 06/09/26)",
    ["Maiorano"],
    "199019"
  );
  console.log(`\n\n=== probe done (READ-ONLY; nothing modified in Pocomos) ===`);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
