/**
 * Probe 2 for the conversion-cleanup rewrite. READ-ONLY (no writes anywhere).
 *
 *  - Size of every policed folder + the Active Customer folder.
 *  - Distribution of the stored "Customer ID" custom field across a sample
 *    (does it hold lead ids, external customer numbers, internal ids?).
 *  - Build the active roster (status Active) indexed by internal id + phone,
 *    then test how many policed contacts would match by id vs phone-bridge.
 *  - Confirm Igor's two contacts resolve.
 *
 * Run (PB token is Production-only; pass it inline):
 *   $env:PHONEBURNER_TOKEN='...'; node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-pb-folders.ts
 */
import { fetchAllCustomers } from "../src/lib/pocomos";
import { listContactsInFolder, normalizePhone } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

const POLICED = [
  FOLDERS.LEADS_FRESH,
  FOLDERS.LEADS_GENERAL,
  FOLDERS.LEADS_COMPETITOR,
  FOLDERS.LEADS_FINANCIAL,
  FOLDERS.CANCELLED_COMPETITOR,
  FOLDERS.CANCELLED_FINANCIAL,
  FOLDERS.CANCELLED_RESULTS,
  FOLDERS.CANCELLED_NO_REACH,
  FOLDERS.CANCELLED_PERSONAL,
];

function custIdOf(c: { custom_fields?: Array<{ name: string; value: string }> }): string {
  return (c.custom_fields ?? []).find((f) => f.name === "Customer ID")?.value ?? "";
}

(async () => {
  // Active roster (status Active; tag gate omitted in this probe — plumbing only).
  const all = await fetchAllCustomers();
  const active = all.filter((c) => String(c.status || "").toLowerCase() === "active");
  const byId = new Set<string>();
  const byPhone = new Map<string, { id: string; lastName: string }>();
  for (const c of active) {
    const r = c as Record<string, unknown>;
    byId.add(String(r.id));
    const ph = normalizePhone(String(r.phone ?? ""));
    const last = String(r.lastName ?? r.last_name ?? "").toLowerCase().trim();
    if (ph.length === 10) byPhone.set(ph, { id: String(r.id), lastName: last });
  }
  console.log(`Active roster: ${active.length} | byPhone entries: ${byPhone.size}`);

  let totalScanned = 0;
  let matchById = 0;
  let matchByPhone = 0;
  let nameMismatch = 0;
  let noMatch = 0;
  const custIdShapes = { numeric6or7: 0, leadLike: 0, empty: 0, other: 0 };
  const sampleCustIds: string[] = [];

  for (const folder of POLICED) {
    let count = 0;
    let fId = 0;
    let fPhone = 0;
    for await (const c of listContactsInFolder(folder, 200)) {
      count++;
      totalScanned++;
      const cid = custIdOf(c).trim();
      if (sampleCustIds.length < 25 && cid) sampleCustIds.push(`${folder}:${cid}`);
      if (!cid) custIdShapes.empty++;
      else if (/^\d{5,7}$/.test(cid)) custIdShapes.numeric6or7++;
      else if (/^\d{6,}$/.test(cid)) custIdShapes.leadLike++;
      else custIdShapes.other++;

      const ph = normalizePhone(c.raw_phone);
      const last = String(c.last_name ?? "").toLowerCase().trim();

      if (cid && byId.has(cid)) {
        matchById++;
        fId++;
      } else if (ph.length === 10 && byPhone.has(ph)) {
        const cust = byPhone.get(ph)!;
        if (cust.lastName && last && cust.lastName === last) {
          matchByPhone++;
          fPhone++;
        } else {
          nameMismatch++;
        }
      } else {
        noMatch++;
      }
    }
    console.log(`  folder ${folder}: ${count} contacts (id-match ${fId}, phone-match ${fPhone})`);
  }

  console.log(`\nScanned: ${totalScanned}`);
  console.log(`  match by id:        ${matchById}`);
  console.log(`  match by phone:     ${matchByPhone}`);
  console.log(`  name mismatch skip: ${nameMismatch}`);
  console.log(`  no match:           ${noMatch}`);
  console.log(`\nCustomer ID field shapes: ${JSON.stringify(custIdShapes)}`);
  console.log(`Sample Customer IDs: ${sampleCustIds.join(", ")}`);

  // Igor focus
  console.log(`\n--- Igor (Lipkin) in policed folders ---`);
  for (const folder of POLICED) {
    for await (const c of listContactsInFolder(folder, 200)) {
      if (!String(c.last_name ?? "").toLowerCase().includes("lipkin")) continue;
      const cid = custIdOf(c);
      const ph = normalizePhone(c.raw_phone);
      const idHit = cid && byId.has(cid);
      const phHit = ph.length === 10 && byPhone.has(ph);
      const nameOk = phHit && byPhone.get(ph)!.lastName === String(c.last_name).toLowerCase().trim();
      console.log(
        `  folder ${folder} user_id=${c.user_id} custId=${cid} phone=${ph} ` +
          `=> idMatch=${!!idHit} phoneMatch=${phHit} nameOk=${nameOk}`
      );
    }
  }

  // Active Customer folder size (destination)
  let activeFolder = 0;
  for await (const _ of listContactsInFolder(FOLDERS.ACTIVE_CUSTOMER, 200)) activeFolder++;
  console.log(`\nActive Customer folder (${FOLDERS.ACTIVE_CUSTOMER}) currently holds ${activeFolder} contacts`);

  console.log("\nDONE");
})();
