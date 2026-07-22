/**
 * PROBE (READ-ONLY, rev 57): does the Unpaid Invoices report include invoices
 * whose DUE DATE is in the future (installment customers), or only past-due?
 *
 * Dumps the report's column structure, then per-invoice due dates; splits each
 * customer's balance into past-due vs future-due, and cross-refs the current
 * paused roster to show who would move if the balance became past-due-only.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-unpaid-duedates.ts
 */
import {
  getSessionedHtml,
  getPocomosSession,
  pocomosWebBase,
} from "../src/lib/pocomos/webSession";
import { sql } from "../src/lib/db";

const OFFICE = process.env.POCOMOS_OFFICE || "1512";

function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

(async () => {
  const now = new Date();
  const page = await getSessionedHtml("/finance/unpaid");
  const token =
    (page.match(/name="unpaid_search_terms\[_token\]"\s*value="([^"]+)"/i) ||
      page.match(/value="([^"]+)"\s*name="unpaid_search_terms\[_token\]"/i))?.[1] ?? null;
  if (!token) throw new Error("no CSRF token");

  const D = "unpaid_search_terms[reminderSearchTermsType][searchTermsType][dates]";
  const b = new URLSearchParams();
  b.set("unpaid_search_terms[_token]", token);
  b.set("unpaid_search_terms[branches][]", OFFICE);
  b.set("unpaid_search_terms[includeMiscInvoices]", "1");
  for (const k of ["lessThan30", "thirtyTo60", "sixtyTo90", "moreThan90"]) {
    b.set(`unpaid_search_terms[${k}]`, "1");
  }
  b.set("unpaid_search_terms[status]", "Unpaid");
  b.set(`${D}[dateStart]`, fmtDate(new Date(now.getFullYear() - 3, 0, 1)));
  b.set(`${D}[dateEnd]`, fmtDate(new Date(now.getFullYear() + 1, 11, 31)));
  b.set("unpaid_search_terms[reminderSearchTermsType][email]", "");

  const cookie = await getPocomosSession();
  const resp = await fetch(`${pocomosWebBase()}/finance/unpaid-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie,
      Referer: `${pocomosWebBase()}/finance/unpaid`,
      "User-Agent": "ms-operations-hub-sync/1.0",
    },
    body: b.toString(),
    cache: "no-store",
  });
  const html = await resp.text();
  console.log(`POST ${resp.status}, ${html.length} bytes`);

  const table = html.match(/<table\b[^>]*id="main-table"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) throw new Error("no #main-table");
  const thead = table[1].match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  const headers = [...(thead?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  );
  console.log("columns:", JSON.stringify(headers));

  // First data row raw, to see the cell layout once.
  const firstRow = table[1].match(/<tbody[\s\S]*?(<tr\b[^>]*>[\s\S]*?<\/tr>)/i)?.[1];
  console.log("\nfirst row HTML (truncated):\n", (firstRow || "").slice(0, 1200));

  // Per-invoice: customer id, balance, all cell texts (find the date-looking one).
  const todayIso = new Date().toISOString().slice(0, 10);
  const toIso = (us: string) => {
    const m = us.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
  };
  type Inv = { id: string; balance: number; dates: string[]; cells: string[] };
  const invoices: Inv[] = [];
  const bodyHtml = table[1].replace(/<thead[\s\S]*?<\/thead>/i, "");
  for (const tr of bodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const id = (tr[1].match(/\/customer\/(\d+)/) || [])[1];
    const balRaw = (tr[1].match(/class="balance">\s*([\d,]+\.\d{2})/i) || [])[1];
    if (!id || !balRaw) continue;
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    );
    const dates = cells.filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
    invoices.push({ id, balance: parseFloat(balRaw.replace(/,/g, "")), dates, cells });
  }
  console.log(`\nparsed ${invoices.length} invoices`);
  console.log("sample rows (id | cells):");
  for (const inv of invoices.slice(0, 5)) console.log(` ${inv.id} | ${inv.cells.join(" | ")}`);

  // Which date cell is the DUE date? Print distribution of each date-position.
  // Then classify: any invoice with a due date AFTER today?
  const futureByLastDate = invoices.filter((i) => {
    const iso = i.dates.length ? toIso(i.dates[i.dates.length - 1]) : null;
    return iso != null && iso > todayIso;
  });
  const futureByAnyDate = invoices.filter((i) =>
    i.dates.some((d) => (toIso(d) ?? "") > todayIso)
  );
  console.log(
    `\ninvoices with LAST date-cell in the future: ${futureByLastDate.length}; with ANY future date: ${futureByAnyDate.length}`
  );
  for (const inv of futureByAnyDate.slice(0, 10)) {
    console.log(`  FUTURE: cust ${inv.id} $${inv.balance} dates=${inv.dates.join(",")}`);
  }

  // Installment-looking customers: 2+ invoices incl. at least one future-dated.
  const byCust = new Map<string, Inv[]>();
  for (const i of invoices) {
    byCust.set(i.id, [...(byCust.get(i.id) ?? []), i]);
  }
  const installment = [...byCust.entries()].filter(
    ([, list]) => list.length >= 2 && list.some((i) => i.dates.some((d) => (toIso(d) ?? "") > todayIso))
  );
  console.log(`\ninstallment-looking customers (2+ invoices, some future-due): ${installment.length}`);
  for (const [id, list] of installment.slice(0, 6)) {
    console.log(
      `  cust ${id}: ${list.map((i) => `$${i.balance} due ${i.dates[i.dates.length - 1] ?? "?"}`).join(" · ")}`
    );
  }

  // Cross-ref the paused roster: past-due-only vs stored balance.
  const paused = (await sql`
    SELECT pocomos_id, full_name, open_balance::float AS bal
    FROM mosquito_service_status WHERE status = 'paused_balance' AND open_balance > 0
    ORDER BY open_balance DESC
  `) as Array<{ pocomos_id: string; full_name: string | null; bal: number }>;
  console.log(`\npaused roster (${paused.length}) — stored vs past-due-only vs future portions:`);
  for (const p of paused) {
    const list = byCust.get(p.pocomos_id) ?? [];
    const past = list
      .filter((i) => ((i.dates.length ? toIso(i.dates[i.dates.length - 1]) : null) ?? "0000") <= todayIso)
      .reduce((s, i) => s + i.balance, 0);
    const future = list
      .filter((i) => ((i.dates.length ? toIso(i.dates[i.dates.length - 1]) : null) ?? "") > todayIso)
      .reduce((s, i) => s + i.balance, 0);
    console.log(
      `  ${p.full_name} (${p.pocomos_id}): stored $${p.bal} | past-due $${past.toFixed(2)} | future-due $${future.toFixed(2)}${past === 0 ? "  << WOULD LEAVE LIST under past-due-only" : ""}`
    );
  }
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
