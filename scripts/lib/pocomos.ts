/**
 * Pocomos helpers for one-off scripts. Re-exports the app's session layer and
 * adds the canonical **legacy DataTables 1.9** body builder that 11+ probe
 * scripts were each re-implementing.
 *
 * ⚠ READ-ONLY. GET + DataTables-read POST only. NEVER:
 *   - POST /customer/{id}/contract/{pcid}/service-history/{paid,unpaid}  (async ACTIONS)
 *   - POST /customer/{id}/active-contract/{pcid}/update                  (contract switcher)
 *   - treat a 405-on-GET endpoint as a feed that "just needs POST"       (it's an action)
 *   - use the per-contract PDF export as data                           (invoice packet, inaccurate)
 * See the pocomos-scraping skill for the full landmine list.
 */
export {
  getSessionedHtml,
  postSessioned,
  getPocomosSession,
  pocomosWebBase,
  invalidateSession,
} from "../../src/lib/pocomos/webSession";

/**
 * Build a **legacy DataTables 1.9** request body — the shape every Pocomos
 * `/*-data` DataTables endpoint requires. Modern 1.10+ params (`draw`, `start`,
 * `length`, `columns[]`, `order[]`, `search[value]`) are SILENTLY IGNORED, so
 * getting this wrong returns 200 with a wrong-ordered default view, not an error.
 * The `mDataProp_N` entries are load-bearing: the endpoint resolves
 * `iSortCol_0` to a field name through them.
 *
 * @param columns  ordered column field names (their index is the sort index)
 * @param opts.start / length  paging
 * @param opts.sortColumn  field name to sort by (defaults to columns[0])
 * @param opts.sortDir  "asc" | "desc" (default "desc")
 */
export function legacyDataTablesBody(
  columns: readonly string[],
  opts: {
    start?: number;
    length?: number;
    /** Field to sort by (defaults to columns[0]). Pass `sort: false` to send no sort. */
    sortColumn?: string;
    sortDir?: "asc" | "desc";
    /** Set false to omit the sort entirely (iSortingCols=0) — matches endpoints that don't sort. */
    sort?: boolean;
  } = {}
): URLSearchParams {
  const { start = 0, length = 200, sortColumn, sortDir = "desc", sort = true } = opts;
  const b = new URLSearchParams();
  b.set("sEcho", "1");
  b.set("iColumns", String(columns.length));
  // Named columns → comma-join; numeric-index columns → the endpoint just wants
  // the right count, so an empty sColumns of the right arity also works.
  b.set("sColumns", columns.every((c) => /^\d+$/.test(c)) ? ",".repeat(columns.length - 1) : columns.join(","));
  b.set("iDisplayStart", String(start));
  b.set("iDisplayLength", String(length));
  columns.forEach((c, i) => {
    b.set(`mDataProp_${i}`, c);
    b.set(`sSearch_${i}`, "");
    b.set(`bRegex_${i}`, "false");
    b.set(`bSearchable_${i}`, "true");
    b.set(`bSortable_${i}`, "true");
  });
  b.set("sSearch", "");
  b.set("bRegex", "false");
  if (sort) {
    const sortIdx = Math.max(0, columns.indexOf(sortColumn ?? columns[0]));
    b.set("iSortCol_0", String(sortIdx));
    b.set("sSortDir_0", sortDir);
    b.set("iSortingCols", "1");
  } else {
    b.set("iSortingCols", "0");
  }
  return b;
}

/** The `/leads/data` open-leads feed columns (order matters — see leadSync.ts). */
export const LEADS_DATA_COLUMNS = [
  "name_with_company",
  "address",
  "phone",
  "map_code",
  "status",
  "date_added",
  "salesperson",
  "note",
  "function",
] as const;
