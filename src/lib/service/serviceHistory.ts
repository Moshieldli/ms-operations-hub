/**
 * Parser for the Pocomos web "Service History" page (Surface C — HTML scrape).
 *
 * Confirmed by scripts/probe-service-history.ts:
 *  - The completed-services rows live in the page HTML (no XHR / JWT needed).
 *  - A single fetch of /customer/{id}/service-history renders ONLY the
 *    currently-selected contract's table (`#services-table`).
 *  - Rows are NOT date-sorted in the HTML — callers must compute max(date).
 *  - The "Selected Contract:" dropdown toggle text names the contract whose
 *    table is shown. Switching contracts is a stateful POST; this module is
 *    READ-ONLY and never switches.
 *
 * Everything here is regex-based (no DOM/cheerio dependency), matching the
 * style of the other probes/parsers in this repo.
 */

export interface ServiceRow {
  invoice: string;
  /** Raw date text as shown, e.g. "05/16/2025" (duration "(7 mins)" stripped). */
  date: string;
  /** Parsed Date (local midnight) or null if unparseable. */
  parsedDate: Date | null;
  /** "Complete" | "Cancelled" | ... (cell text). */
  status: string;
  /** "Regular" | "Initial" | "Respray" | ... (cell text). */
  type: string;
  technician: string;
}

export interface ParsedServiceHistory {
  /**
   * The contract label printed in the Completed Services widget header, e.g.
   * "Mosquito Control - Weekly - Mosquito Control - Active". This is the
   * AUTHORITATIVE identity of the rendered table's contract and is present
   * whether or not a contract switcher exists. null if not found.
   */
  tableContractLabel: string | null;
  /** Text of the "Selected Contract:" dropdown toggle (multi-contract pages
   *  only; null when the customer has a single contract — no switcher). */
  selectedContractLabel: string | null;
  /** The contract id bound to the rendered table (from the Export History href). */
  tableContractId: string | null;
  rows: ServiceRow[];
}

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

/** Parse "MM/DD/YYYY" (optionally trailing text) into a local-midnight Date. */
export function parseUsDate(raw: string): Date | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

function extractTableInner(html: string, tableId: string): string | null {
  const re = new RegExp(
    `<table\\b[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)<\\/table>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

/** True if the page is the Pocomos login form rather than a real page. */
export function looksLikeLoginPage(html: string): boolean {
  return /name="form\[username\]"/i.test(html) || /id="login_form"/i.test(html);
}

/**
 * Extract the customer's route CODE from a `/customer/{id}/service-information`
 * page. The customer's "Routing" widget renders as
 * `Routing / Code {value} / County … / Lot Size …`. Confirmed live 2026-07-07
 * (values like "510", "505"; codes can also be alphanumeric like "WF2").
 *
 * The page ALSO has a nav sidebar "Routing" dropdown (Route List / Reminder /
 * …) — skipped via the submenu/menu-text markers. Returns the code or null.
 * (`customer-information` 404s; service-information is the profile page.)
 */
export function parseRouteCode(html: string): string | null {
  for (const m of html.matchAll(/Routing/gi)) {
    const start = m.index ?? 0;
    const head = html.slice(start, start + 120);
    if (/submenu|menu-text|dropdown-toggle/i.test(head)) continue; // nav dropdown, not the widget
    const text = stripTags(html.slice(start, start + 400));
    // "Routing Code 510 County ..." — the token right after the Code label.
    const cm = text.match(/\bCode\s+([A-Za-z0-9][A-Za-z0-9-]*)/i);
    if (cm && !/^(county|lot|pests|acres)$/i.test(cm[1])) return cm[1];
  }
  return null;
}

export interface ScheduledRow {
  /** ISO date "YYYY-MM-DD" of the scheduled job, or null if unparseable. */
  date: string | null;
  type: string;
  status: string;
  /** "Assigned" | "Unassigned". */
  routeAssigned: string;
  /** Assigned route/technician name, e.g. "Cesar Barrerra" or "Z-ASAP 01". */
  technician: string;
}

/**
 * Parse the `#scheduled-table` on a `/customer/{id}/scheduled-services` page.
 * Columns (confirmed 2026-07-08 via scripts/probe-asap-route.ts):
 *   [checkbox, Date Scheduled, Type, Status, Service Price, Invoice Total,
 *    Route Assigned, Technician, actions]
 * The ASAP route surfaces as the Technician value "Z-ASAP 01" (with Route
 * Assigned = "Assigned"), NOT literally in the Route Assigned column — and the
 * string "ASAP" appears elsewhere on the page (the route dropdown), so ASAP
 * MUST be detected per-row from this table, never by a page substring.
 */
export function parseScheduledServices(html: string): ScheduledRow[] {
  const inner = extractTableInner(html, "scheduled-table");
  if (!inner) return [];
  const bodyMatch = inner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = bodyMatch ? bodyMatch[1] : inner;
  const rows: ScheduledRow[] = [];
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (cells.length < 8) continue;
    const dateText = stripTags(cells[1]).replace(/\(.*?\)/g, "").trim();
    const d = parseUsDate(dateText);
    rows.push({
      date: d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : null,
      type: stripTags(cells[2]),
      status: stripTags(cells[3]),
      routeAssigned: stripTags(cells[6]),
      technician: stripTags(cells[7]),
    });
  }
  return rows;
}

/**
 * True if the customer has an UPCOMING job (scheduled date >= todayIso, Eastern)
 * assigned to an ASAP route — i.e. a not-yet-past job whose Route Assigned is
 * "Assigned" and whose route/technician name matches /asap/. This is the signal
 * that an overdue account is actively being caught up.
 */
export function hasAsapUpcomingJob(rows: ScheduledRow[], todayIso: string): boolean {
  return rows.some(
    (r) =>
      r.date != null &&
      r.date >= todayIso &&
      /assigned/i.test(r.routeAssigned) &&
      !/unassigned/i.test(r.routeAssigned) &&
      /asap/i.test(r.technician)
  );
}

/**
 * Count COMPLETED mosquito services per calendar year from parsed
 * service-history rows. Only Status="Complete" rows with a parseable date are
 * counted; every completed service type on the mosquito contract's table counts
 * (Initial / Regular / Re-service / Respray). Event Spray is a SEPARATE contract
 * and never appears on this table, so it is excluded by construction. Returns a
 * plain map { year: count } for the given years of interest.
 */
export function countCompletedByYear(rows: ServiceRow[], years: number[]): Record<number, number> {
  const want = new Set(years);
  const out: Record<number, number> = {};
  for (const y of years) out[y] = 0;
  for (const r of rows) {
    if (!/complete/i.test(r.status) || r.parsedDate == null) continue;
    const y = r.parsedDate.getFullYear();
    if (want.has(y)) out[y] += 1;
  }
  return out;
}

export function parseSelectedContractLabel(html: string): string | null {
  const idx = html.search(/Selected Contract/i);
  if (idx < 0) return null;
  const region = html.slice(idx, idx + 4000);
  const m = region.match(/dropdown-toggle[^>]*>([\s\S]*?)<\/a>/i);
  return m ? stripTags(m[1]) : null;
}

/**
 * The contract label in the "Completed Services" widget header. It's a bare
 * `<div class="widget-toolbar"> {ContractType} - {ServiceFamily} - {Status} </div>`
 * sitting next to the Export/Download button group. We scan the widget header
 * region, skip the button-group toolbar, and take the plain-text label.
 */
export function parseTableContractLabel(html: string): string | null {
  const ci = html.search(/Completed Services/i);
  if (ci < 0) return null;
  const tableIdx = html.indexOf('id="services-table"', ci);
  const region = html.slice(ci, tableIdx > ci ? tableIdx : ci + 3000);
  let fallback: string | null = null;
  for (const m of region.matchAll(/<div\s+class="widget-toolbar">([\s\S]*?)<\/div>/gi)) {
    const text = stripTags(m[1]);
    if (!text) continue;
    if (/export|download|summary|paid|unpaid/i.test(text)) continue;
    // The contract label ends with its status; prefer that, else first plain one.
    if (/-\s*(active|cancelled|canceled|on-?hold|inactive)\s*$/i.test(text)) {
      return text;
    }
    if (fallback == null && text.includes(" - ")) fallback = text;
  }
  return fallback;
}

/**
 * Parse the Completed Services table (`#services-table`) and the selected
 * contract label from a service-history page's HTML.
 */
export function parseServiceHistory(html: string): ParsedServiceHistory {
  const tableContractLabel = parseTableContractLabel(html);
  const selectedContractLabel = parseSelectedContractLabel(html);
  const tableContractId =
    (html.match(/contract\/(\d+)\/history\/download/i) || [])[1] ?? null;

  const inner = extractTableInner(html, "services-table");
  const rows: ServiceRow[] = [];
  if (inner) {
    // Only parse <tbody> rows; skip the <thead>.
    const bodyMatch = inner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
    const body = bodyMatch ? bodyMatch[1] : inner;
    for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = Array.from(
        tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)
      ).map((c) => c[1]);
      if (cells.length < 8) continue; // not a data row
      const dateText = stripTags(cells[1]).replace(/\(.*?\)/g, "").trim();
      rows.push({
        invoice: stripTags(cells[0]),
        date: dateText,
        parsedDate: parseUsDate(dateText),
        status: stripTags(cells[2]),
        type: stripTags(cells[3]),
        technician: stripTags(cells[7]),
      });
    }
  }

  return { tableContractLabel, selectedContractLabel, tableContractId, rows };
}
