/**
 * Probe for the conversion-cleanup rewrite (roster-reconciliation model).
 * READ-ONLY. No Pocomos/PhoneBurner writes, no Postgres writes.
 *
 * Answers, against LIVE data:
 *  1) JWT customer-list record: which id is the user-facing "Customer ID"
 *     (external_account_id vs customer_number vs id)? Print Igor Lipkin's
 *     full field set and a couple of generic samples.
 *  2) /customers/data grid raw row: what does `id` hold, is there a Tags
 *     column, and does grid `id` line up with the JWT external id? Print one
 *     raw Active row's keys + values and Igor's grid row.
 *  3) Igor's PhoneBurner contacts: confirm the two contacts (lead 5505704 in
 *     General 66223881, customer 198709 in Cancelled-Personal 66223888) and
 *     what their "Customer ID" custom field + phone actually store.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-roster-reconcile.ts
 */
import { fetchAllCustomers } from "../src/lib/pocomos";
import { postSessioned } from "../src/lib/pocomos/webSession";
import { listContactsInFolder, normalizePhone } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

function show(label: string, obj: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
}

async function fetchCustomersDataPage(start: number, len: number): Promise<Record<string, unknown>[]> {
  const COLS = 11;
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(COLS));
  body.set("sColumns", ",".repeat(COLS - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(len));
  for (let i = 0; i < COLS; i++) {
    body.set(`mDataProp_${i}`, String(i));
    body.set(`sSearch_${i}`, "");
    body.set(`bRegex_${i}`, "false");
    body.set(`bSearchable_${i}`, "true");
    body.set(`bSortable_${i}`, "true");
  }
  body.set("sSearch", "");
  body.set("bRegex", "false");
  body.set("iSortingCols", "0");
  const resp = await postSessioned<{ aaData?: Record<string, unknown>[] }>(
    "/customers/data",
    body,
    { referer: "/customers/" }
  );
  return resp.aaData ?? [];
}

(async () => {
  // -- 1. JWT customer list --------------------------------------------------
  const all = await fetchAllCustomers();
  console.log(`JWT customer-list rows: ${all.length}`);
  const active = all.filter((c) => String(c.status || "").toLowerCase() === "active");
  console.log(`  active: ${active.length}`);

  const sample = active[0] as Record<string, unknown>;
  console.log(`\nKeys on a JWT customer record:\n  ${Object.keys(sample).join(", ")}`);
  show("JWT sample active customer (full)", sample);

  const igorJwt = all.find(
    (c) =>
      String((c as Record<string, unknown>).external_account_id ?? "") === "198709" ||
      String((c as Record<string, unknown>).customer_number ?? "") === "198709" ||
      String(c.id) === "1217555"
  );
  show("JWT Igor Lipkin (matched on 198709 / 1217555)", igorJwt ?? "NOT FOUND");

  // -- 2. /customers/data grid ----------------------------------------------
  const firstRows = await fetchCustomersDataPage(0, 5);
  console.log(`\n/customers/data first page rows: ${firstRows.length}`);
  if (firstRows[0]) {
    console.log(`Grid row keys: ${Object.keys(firstRows[0]).join(", ")}`);
    show("/customers/data raw row[0]", firstRows[0]);
  }

  // Find Igor across the grid (search all pages for last name Lipkin in col 2).
  let igorGrid: Record<string, unknown> | undefined;
  for (let p = 0; p < 8 && !igorGrid; p++) {
    const rows = await fetchCustomersDataPage(p * 200, 200);
    igorGrid = rows.find((r) => String(r["2"] ?? "").toLowerCase().includes("lipkin"));
    if (rows.length < 200) break;
  }
  show("/customers/data Igor (last name Lipkin)", igorGrid ?? "NOT FOUND");

  // -- 3. Igor's PhoneBurner contacts ---------------------------------------
  for (const [name, folder] of [
    ["General 66223881", FOLDERS.LEADS_GENERAL],
    ["Cancelled-Personal 66223888", FOLDERS.CANCELLED_PERSONAL],
  ] as const) {
    let found = 0;
    for await (const c of listContactsInFolder(folder, 200)) {
      const last = String(c.last_name ?? "").toLowerCase();
      if (!last.includes("lipkin")) continue;
      found++;
      const custId = (c.custom_fields ?? []).find((f) => f.name === "Customer ID")?.value;
      console.log(
        `\n[${name}] PB contact user_id=${c.user_id} name=${c.first_name} ${c.last_name} ` +
          `phone=${normalizePhone(c.raw_phone)} CustomerIDfield=${custId} catId=${c.category_id}`
      );
    }
    if (!found) console.log(`\n[${name}] no Lipkin contact found in this folder`);
  }

  console.log("\nDONE");
})();
