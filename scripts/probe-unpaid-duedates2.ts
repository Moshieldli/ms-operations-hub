/**
 * PROBE 2 (READ-ONLY): correct per-invoice parsing of the unpaid report —
 * due date is "Due MM/DD/YY" inside the Dates cell; each row also carries an
 * explicit "Status: X" text. Tallies statuses and future-vs-past due dates.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-unpaid-duedates2.ts
 */
import {
  getSessionedHtml,
  getPocomosSession,
  pocomosWebBase,
} from "../src/lib/pocomos/webSession";

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

  const table = html.match(/<table\b[^>]*id="main-table"[^>]*>([\s\S]*?)<\/table>/i)!;
  const bodyHtml = table[1].replace(/<thead[\s\S]*?<\/thead>/i, "");
  const todayIso = new Date().toISOString().slice(0, 10);
  const toIso = (us: string) => {
    // MM/DD/YY → 20YY-MM-DD
    const m = us.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (!m) return null;
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1]}-${m[2]}`;
  };

  const statusCount = new Map<string, number>();
  let future = 0;
  let past = 0;
  let noDue = 0;
  const futureRows: string[] = [];
  for (const tr of bodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const id = (tr[1].match(/\/customer\/(\d+)/) || [])[1];
    const balRaw = (tr[1].match(/class="balance">\s*([\d,]+\.\d{2})/i) || [])[1];
    if (!id || !balRaw) continue;
    const due = (tr[1].match(/<strong>Due<\/strong>\s*<br>\s*([\d/]+)/i) || [])[1] ?? null;
    const status = (tr[1].replace(/<[^>]+>/g, " ").match(/Status:\s*([A-Za-z][A-Za-z ]*?)\s+Balance/i) || [])[1]?.trim() ?? "?";
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    const dueIso = due ? toIso(due) : null;
    if (!dueIso) noDue++;
    else if (dueIso > todayIso) {
      future++;
      futureRows.push(`cust ${id} due ${due} $${balRaw} status=${status}`);
    } else past++;
  }
  console.log(`today=${todayIso}`);
  console.log(`invoices: past-due=${past}, FUTURE-due=${future}, no-due-parsed=${noDue}`);
  console.log("status distribution:", JSON.stringify([...statusCount.entries()]));
  for (const r of futureRows.slice(0, 15)) console.log("  FUTURE:", r);

  // Due-date spread — earliest/latest, to see how wide the report actually is.
  const dues: string[] = [];
  for (const tr of bodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const due = (tr[1].match(/<strong>Due<\/strong>\s*<br>\s*([\d/]+)/i) || [])[1];
    const iso = due ? toIso(due) : null;
    if (iso) dues.push(iso);
  }
  dues.sort();
  console.log(`due-date range: ${dues[0]} .. ${dues[dues.length - 1]} (${dues.length} dated)`);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
