/**
 * Bulk "Last Service" source — Pocomos web back-door POST /customers/data
 * (Surface B). READ-ONLY. Mirrors the lead-sync DataTables 1.9 pattern (see
 * lib/sync/leadSync.ts + docs/REFERENCE.md). ~6 POSTs at 200/page covers the
 * whole office (~1,127 customers).
 *
 * Rows come back as POSITIONAL arrays keyed "0".."10" (the server ignores the
 * mDataProp field names and returns columns by index) plus appended named keys
 * id / multiple_contracts / commercial_account. Column map (from /customers/
 * <thead>): 1 First, 2 Last, 3 Phone, 4 Email, 5 Zip, 6 Status,
 * 7 Sign up date, 8 LAST SERVICE (MM/DD/YY), 9 Next Service.
 *
 * Column 8 is per-CUSTOMER and is the last service of ANY type — authoritative
 * for mosquito-only customers; for add-on customers it may reflect the add-on,
 * so those are scraped per-page instead.
 */
import { postSessioned } from "@/lib/pocomos/webSession";

const PAGE_SIZE = 200;
const COLS = 11; // 0..10 per the /customers/ table header
const LAST_SERVICE_COL = "8";

export interface CustomerLastService {
  id: string;
  /** Parsed "Last Service" date (local midnight) or null when blank/"n/a". */
  lastService: Date | null;
  /** Raw cell text as shown, e.g. "06/09/26". */
  lastServiceRaw: string;
  /** multiple_contracts flag from the row (0 = single contract). */
  multipleContracts: number;
  /** Status cell (column 6), e.g. "Active". */
  status: string;
}

export interface BulkLastServiceResult {
  byId: Map<string, CustomerLastService>;
  pages: number;
  total: number | null;
}

interface CustomersDataResponse {
  aaData?: Array<Record<string, unknown>>;
  iTotalRecords?: number;
  iTotalDisplayRecords?: number;
  type?: string;
  redirect?: string;
}

/** Parse "MM/DD/YY" or "MM/DD/YYYY" → local-midnight Date (null if blank/n/a). */
function parseShortUsDate(raw: string): Date | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

async function fetchPage(start: number): Promise<CustomersDataResponse> {
  // Legacy DataTables 1.9 body — modern 1.10+ params are silently ignored.
  const body = new URLSearchParams();
  body.set("sEcho", "1");
  body.set("iColumns", String(COLS));
  body.set("sColumns", ",".repeat(COLS - 1));
  body.set("iDisplayStart", String(start));
  body.set("iDisplayLength", String(PAGE_SIZE));
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
  return postSessioned<CustomersDataResponse>("/customers/data", body, {
    referer: "/customers/",
  });
}

/**
 * Pull every customer's "Last Service" date. Pages until a short page is
 * returned (or maxPages as a safety cap). One shared web session is reused.
 */
export async function fetchAllCustomersLastService(
  maxPages = 20
): Promise<BulkLastServiceResult> {
  const byId = new Map<string, CustomerLastService>();
  let pages = 0;
  let total: number | null = null;

  for (let p = 0; p < maxPages; p++) {
    const resp = await fetchPage(p * PAGE_SIZE);
    pages++;
    if (total == null && typeof resp.iTotalRecords === "number") {
      total = resp.iTotalRecords;
    }
    const rows = resp.aaData ?? [];
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (!id) continue;
      const raw = String(r[LAST_SERVICE_COL] ?? "").trim();
      byId.set(id, {
        id,
        lastService: parseShortUsDate(raw),
        lastServiceRaw: raw,
        multipleContracts: Number(r.multiple_contracts ?? 0),
        status: String(r["6"] ?? ""),
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return { byId, pages, total };
}
