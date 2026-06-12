/**
 * Bulk OPEN-BALANCE source for the /service/overdue report. READ-ONLY.
 *
 * Why not /customers/data? The "Balance" field is NOT a column in this office's
 * /customers/data grid — that grid is configured with only 11 columns
 * (0 select · 1 First · 2 Last · 3 Phone · 4 Email · 5 Zip · 6 Status ·
 *  7 Sign up date · 8 Last Service · 9 Next Service · 10 actions). Probed live
 * 2026-06-12; columns 11+ come back empty. So balance comes from the web
 * "Unpaid Invoices" report instead.
 *
 * Surface: POST /finance/unpaid-data (the same PHPSESSID web session as the
 * lead sync / customers bulk). It is a Symfony search form, not a JSON grid:
 *   - GET /finance/unpaid first to scrape the CSRF `_token`.
 *   - POST the form with: the token, branches[]=office, includeMiscInvoices,
 *     all four aging buckets (lessThan30..moreThan90), status=Unpaid, and a
 *     wide Due-date window. Without status=Unpaid the server 500s / returns an
 *     empty shell; with only the default (empty) body it silently clamps the
 *     Due date to the last 30 days and drops older past-due invoices.
 * The response is an HTML report (#main-table) with ONE ROW PER INVOICE. Each
 * row carries a /customer/{id}/... link and a per-invoice balance in
 * <span class="balance">N.NN</span>. A customer's open balance = the sum of
 * their invoice balances.
 *
 * A search POST only READS — it never mutates a record.
 */
import {
  getSessionedHtml,
  getPocomosSession,
  invalidateSession,
  pocomosWebBase,
} from "@/lib/pocomos/webSession";

const OFFICE = process.env.POCOMOS_OFFICE || "1512";
const USER_AGENT = "ms-operations-hub-sync/1.0";

export interface CustomerBalance {
  id: string;
  /** Total open balance (sum of unpaid invoice balances), dollars. */
  balance: number;
  /** Number of unpaid invoices contributing to the balance. */
  invoices: number;
}

export interface OpenBalanceResult {
  byId: Map<string, CustomerBalance>;
  /** Total invoices parsed across the report. */
  totalInvoices: number;
  /** Sum of all open balances (sanity/telemetry). */
  totalBalance: number;
}

/** MM/DD/YYYY for the form's date fields. */
function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

function extractToken(html: string): string | null {
  const m =
    html.match(/name="unpaid_search_terms\[_token\]"\s*value="([^"]+)"/i) ||
    html.match(/value="([^"]+)"\s*name="unpaid_search_terms\[_token\]"/i);
  return m ? m[1] : null;
}

function buildBody(token: string, now: Date): string {
  const start = new Date(now.getFullYear() - 3, 0, 1); // 3 years back covers any open past-due
  const end = new Date(now.getFullYear() + 1, 11, 31); // through next year (future installments)
  const D = "unpaid_search_terms[reminderSearchTermsType][searchTermsType][dates]";
  const b = new URLSearchParams();
  b.set("unpaid_search_terms[_token]", token);
  b.set("unpaid_search_terms[branches][]", OFFICE);
  b.set("unpaid_search_terms[includeMiscInvoices]", "1");
  for (const k of ["lessThan30", "thirtyTo60", "sixtyTo90", "moreThan90"]) {
    b.set(`unpaid_search_terms[${k}]`, "1");
  }
  b.set("unpaid_search_terms[status]", "Unpaid");
  b.set(`${D}[dateStart]`, fmtDate(start));
  b.set(`${D}[dateEnd]`, fmtDate(end));
  b.set("unpaid_search_terms[reminderSearchTermsType][email]", "");
  return b.toString();
}

async function postReport(body: string): Promise<string> {
  const url = `${pocomosWebBase()}/finance/unpaid-data`;
  const doRequest = async (cookie: string) =>
    fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,*/*",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
        Referer: `${pocomosWebBase()}/finance/unpaid`,
        "User-Agent": USER_AGENT,
      },
      body,
      cache: "no-store",
    });

  let cookie = await getPocomosSession();
  let resp = await doRequest(cookie);
  let text = await resp.text();
  const redirectedToLogin =
    resp.status >= 300 &&
    resp.status < 400 &&
    (resp.headers.get("location") || "").includes("/login");
  if (redirectedToLogin || /name="form\[username\]"/i.test(text)) {
    await invalidateSession();
    cookie = await getPocomosSession();
    resp = await doRequest(cookie);
    text = await resp.text();
  }
  if (!resp.ok) {
    throw new Error(`unpaid-data POST failed: ${resp.status} ${text.slice(0, 160)}`);
  }
  return text;
}

/** Parse #main-table → per-customer summed open balance. */
function parseReport(html: string): OpenBalanceResult {
  const byId = new Map<string, CustomerBalance>();
  let totalInvoices = 0;
  let totalBalance = 0;

  const table = html.match(/<table\b[^>]*id="main-table"[^>]*>([\s\S]*?)<\/table>/i);
  const body = table ? table[1] : "";
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const id = (tr[1].match(/\/customer\/(\d+)/) || [])[1];
    const balRaw = (tr[1].match(/class="balance">\s*([\d,]+\.\d{2})/i) || [])[1];
    if (!id || !balRaw) continue;
    const amount = parseFloat(balRaw.replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    const existing = byId.get(id);
    if (existing) {
      existing.balance = Math.round((existing.balance + amount) * 100) / 100;
      existing.invoices += 1;
    } else {
      byId.set(id, { id, balance: amount, invoices: 1 });
    }
    totalInvoices += 1;
    totalBalance += amount;
  }
  return { byId, totalInvoices, totalBalance: Math.round(totalBalance * 100) / 100 };
}

/**
 * Fetch every customer's open balance from the Unpaid Invoices report.
 * One GET (for the CSRF token) + one POST. Customers not in the returned map
 * have a $0 open balance.
 */
export async function fetchOpenBalances(now: Date = new Date()): Promise<OpenBalanceResult> {
  const page = await getSessionedHtml("/finance/unpaid");
  const token = extractToken(page);
  if (!token) {
    throw new Error("unpaid report: CSRF _token not found on /finance/unpaid");
  }
  const html = await postReport(buildBody(token, now));
  return parseReport(html);
}
