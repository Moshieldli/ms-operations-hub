/**
 * Probe: can we read per-contract service history by scraping the Pocomos
 * web service-history page (Surface C — HTML scrape)?
 *
 * Goal: confirm the "Completed Services" table rows live in the page HTML and
 * figure out how contract scoping works, so we can later build a
 * "no mosquito spray in 15+ days" report.
 *
 * Test customer: 1163370 (Ohavia Feldman) — has BOTH a
 *   - Mosquito Control / Weekly contract, and
 *   - Ant Control / Perimeter contract.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-service-history.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getSessionedHtml, getPocomosSession, pocomosWebBase } from "../src/lib/pocomos/webSession";

const CUSTOMER_ID = 1163370;
const SAMPLE_PATH = resolve(process.cwd(), "docs/service-history-sample.html");

// ---------- tiny HTML helpers (regex-based, like the other probes) ----------

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

/** Return the inner HTML of the first <table ...> ... </table> whose opening
 *  tag or surrounding text matches `near` (case-insensitive). */
function findTableNear(html: string, near: RegExp): { open: string; inner: string; rawFull: string } | null {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  let best: { open: string; inner: string; rawFull: string; dist: number } | null = null;
  // Find an anchor index for `near`
  const anchor = html.search(near);
  while ((m = tableRe.exec(html))) {
    const open = m[0].slice(0, m[0].indexOf(">") + 1);
    const start = m.index;
    const dist = anchor === -1 ? start : Math.abs(start - anchor);
    if (!best || dist < best.dist) {
      best = { open, inner: m[1], rawFull: m[0], dist };
    }
  }
  return best ? { open: best.open, inner: best.inner, rawFull: best.rawFull } : null;
}

function extractRows(tableInner: string): string[] {
  return Array.from(tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1]);
}

function extractCells(rowInner: string): string[] {
  return Array.from(rowInner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) => m[1]);
}

// ---------------------------------------------------------------------------

async function main() {
  const path = `/customer/${CUSTOMER_ID}/service-history`;
  console.log(`=== 1. GET ${path} ===`);
  const html = await getSessionedHtml(path);
  console.log(`html length: ${html.length}`);

  try {
    mkdirSync(resolve(process.cwd(), "docs"), { recursive: true });
  } catch {
    /* exists */
  }
  writeFileSync(SAMPLE_PATH, html, "utf8");
  console.log(`saved raw HTML -> ${SAMPLE_PATH}`);

  // Quick sanity: did we land on a real page or the login page?
  if (/name="form\[username\]"/i.test(html) || /id="login/i.test(html)) {
    console.log("\n!! Page looks like the LOGIN page — session not authenticated. Aborting.");
    return;
  }
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  console.log(`<title>: ${title ? stripTags(title) : "(none)"}`);

  // ---------------- 2. Inspect the "Selected Contract" switcher ------------
  // The switcher is NOT a <select> — it's a Bootstrap btn-group dropdown next
  // to the "Selected Contract:" label. The currently-selected contract is the
  // dropdown-toggle text; the alternatives are <a class="switch-contract"> items.
  console.log(`\n=== 2. "Selected Contract" switcher markup ===`);
  type Contract = { label: string; switchHref?: string; switchContractId?: string };
  const contracts: Contract[] = [];

  // Region from "Selected Contract:" to the closing </ul> of its dropdown.
  const scIdx = html.search(/Selected Contract/i);
  let selectedLabel = "(unknown)";
  if (scIdx >= 0) {
    const region = html.slice(scIdx, scIdx + 4000);
    // Currently-selected contract = text of the dropdown-toggle <a>
    const toggle = region.match(/dropdown-toggle[^>]*>([\s\S]*?)<\/a>/i);
    selectedLabel = toggle ? stripTags(toggle[1]) : "(unknown)";
    console.log(`  currently-selected contract: ${JSON.stringify(selectedLabel)}`);
    contracts.push({ label: selectedLabel });

    // Alternative contracts in the dropdown menu
    for (const a of region.matchAll(/<a\b([^>]*class="[^"]*switch-contract[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = a[1];
      const href = (attrs.match(/href="([^"]*)"/i) || [])[1];
      const cid = (href.match(/active-contract\/(\d+)\/update/i) || [])[1];
      const label = stripTags(a[2]);
      contracts.push({ label, switchHref: href, switchContractId: cid });
      console.log(`  alt contract: ${JSON.stringify(label)}  switch->${href}  (active-contract id=${cid})`);
    }
  } else {
    console.log("  '(could not find Selected Contract label)'");
  }

  // ---------------- 3. How does the page switch contracts? -----------------
  console.log(`\n=== 3. Contract-switching mechanism ===`);
  console.log(`  Mechanism: POST /customer/{id}/active-contract/{contractId}/update  (data-method="post")`);
  console.log(`  -> mutates the customer's server-side SELECTED contract, then the`);
  console.log(`     service-history page renders that contract's Completed Services table.`);
  // The Export History link reveals the contract id bound to the CURRENT table.
  const exportHref = (html.match(/href="(\/customer\/\d+\/contract\/\d+\/history\/download)"/i) || [])[1];
  const currentTableContractId = exportHref ? (exportHref.match(/contract\/(\d+)\//) || [])[1] : undefined;
  console.log(`  Current table's contract id (from Export History link): ${currentTableContractId}`);
  console.log(`  Export History href: ${exportHref}`);
  // (c) Export History button — does it point at a CSV/JSON endpoint?
  console.log(`\n  -- Export History button --`);
  const exportHits = Array.from(
    html.matchAll(/<a\b[^>]*>(?:(?!<\/a>)[\s\S]){0,80}?export[\s\S]{0,40}?<\/a>|<button\b[^>]*>[\s\S]{0,80}?export[\s\S]{0,40}?<\/button>/gi)
  ).map((m) => m[0]);
  // also catch href/data-url near the word "export"
  const exportUrls = Array.from(
    html.matchAll(/(href|data-url|data-href|onclick|formaction)="([^"]*)"/gi)
  )
    .filter((m) => /export|csv|download|\.csv/i.test(m[2]))
    .map((m) => `${m[1]}=${m[2]}`);
  for (const e of exportHits.slice(0, 5)) console.log(`      ${stripTags(e)} :: ${e.replace(/\s+/g, " ").slice(0, 180)}`);
  for (const u of Array.from(new Set(exportUrls)).slice(0, 10)) console.log(`      export-ish url: ${u.slice(0, 200)}`);
  if (!exportHits.length && !exportUrls.length) console.log("      (no export button / url found in markup)");

  // ---------------- 4. Parse the "Completed Services" table ----------------
  console.log(`\n=== 4. "Completed Services" table ===`);
  const completedTable = findTableNear(html, /completed\s*services/i);
  if (!completedTable) {
    console.log("Could not locate a Completed Services table. Tables on page:");
    for (const t of html.matchAll(/<table\b[^>]*>/gi)) console.log(`   ${t[0]}`);
    return;
  }
  console.log(`table open tag: ${completedTable.open}`);
  const rows = extractRows(completedTable.inner);
  console.log(`<tr> count: ${rows.length}`);

  // Header row
  const headerCells = rows.length ? extractCells(rows[0]).map(stripTags) : [];
  console.log(`header cells: ${JSON.stringify(headerCells)}`);

  // Data rows
  console.log(`\nRows:`);
  let dataRowCount = 0;
  const typeValues = new Set<string>();
  for (const r of rows) {
    const cells = extractCells(r);
    if (!cells.length) continue;
    const text = cells.map(stripTags);
    // skip header (cells were <th>) — detect by re-reading raw row for <th
    if (/<th\b/i.test(r) && dataRowCount === 0 && text.join("") === headerCells.join("")) continue;
    if (/<th\b/i.test(r)) continue;
    dataRowCount++;
    // capture any data-* on the row (might carry contract id / service type)
    const rowAttrs = (r.match(/^[\s\S]*?(?=<t[dh])/) || [""])[0]; // not reliable; rows passed inner only
    console.log(`  [${dataRowCount}] ${JSON.stringify(text)}`);
    if (dataRowCount <= 3) {
      // dump raw cells once to see embedded markup (badges, data-attrs)
      cells.forEach((c, i) => {
        const raw = c.replace(/\s+/g, " ").trim();
        if (raw !== stripTags(c)) console.log(`        cell[${i}] raw: ${raw.slice(0, 200)}`);
      });
    }
  }
  console.log(`data rows: ${dataRowCount}`);

  // Heuristic: which column is "Type"? Find header index containing "type".
  const typeIdx = headerCells.findIndex((h) => /type/i.test(h));
  console.log(`\n"Type" column index: ${typeIdx}`);
  if (typeIdx >= 0) {
    for (const r of rows) {
      if (/<th\b/i.test(r)) continue;
      const cells = extractCells(r).map(stripTags);
      if (cells[typeIdx]) typeValues.add(cells[typeIdx]);
    }
    console.log(`distinct Type values: ${JSON.stringify(Array.from(typeValues))}`);
  }

  // ---------------- 5. Does ONE fetch contain BOTH contracts? --------------
  console.log(`\n=== 5. Scoping check — both contracts in one fetch? ===`);
  // The Completed Services widget header carries its OWN contract label.
  const widgetLabel =
    (completedTable.rawFull.match(/widget-toolbar">\s*([^<]*Control[^<]*)\s*<\/div>/i) || [])[1] ||
    selectedLabel;
  console.log(`  Completed Services widget is labeled: ${JSON.stringify(stripTags(widgetLabel))}`);
  const mosqRows = rows.filter((r) => /mosquito/i.test(r)).length;
  const antRows = rows.filter((r) => /\bant\b/i.test(r)).length;
  console.log(`  rows whose markup says "mosquito": ${mosqRows}, "ant": ${antRows}`);
  console.log(`  # of <table id="services-table"> on page: ${(html.match(/id="services-table"/g) || []).length}`);
  console.log(
    `  -> VERDICT: the page renders ONLY the currently-selected contract's table (id=${currentTableContractId}).`
  );

  // ---------------- 6. Test the per-contract Export History endpoint -------
  console.log(`\n=== 6. Export History endpoint (read-only, per-contract) ===`);
  if (exportHref) {
    const cookie = await getPocomosSession();
    const resp = await fetch(`${pocomosWebBase()}${exportHref}`, {
      method: "GET",
      redirect: "manual",
      headers: { Cookie: cookie, "User-Agent": "ms-operations-hub-probe/1.0", Accept: "*/*" },
    });
    const ct = resp.headers.get("content-type") || "";
    const cd = resp.headers.get("content-disposition") || "";
    console.log(`  GET ${exportHref}`);
    console.log(`  status=${resp.status} content-type=${ct} content-disposition=${cd}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    console.log(`  body bytes: ${buf.length}`);
    const isText = /csv/i.test(ct) || /\.csv/i.test(cd) || /json/i.test(ct);
    if (isText) {
      const ext = /json/i.test(ct) ? "json" : "csv";
      const outPath = resolve(process.cwd(), `docs/service-history-export-sample.${ext}`);
      writeFileSync(outPath, buf);
      console.log(`  saved -> ${outPath}`);
      console.log(`  first 600 chars:\n${buf.toString("utf8").slice(0, 600)}`);
    } else {
      console.log(`  -> binary/PDF export, NOT saved (not useful for scraping; scrape the HTML table instead)`);
    }
  } else {
    console.log("  (no Export History href found)");
  }

  // ---------------- 7. Confirm the POST switch changes the table -----------
  console.log(`\n=== 7. Confirm POST-switch changes the rendered contract ===`);
  const alt = contracts.find((c) => c.switchContractId);
  if (alt?.switchContractId) {
    const cookie = await getPocomosSession();
    const doSwitch = async (cid: string) => {
      const r = await fetch(`${pocomosWebBase()}/customer/${CUSTOMER_ID}/active-contract/${cid}/update`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Cookie: cookie,
          "User-Agent": "ms-operations-hub-probe/1.0",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "*/*",
          Referer: `${pocomosWebBase()}${path}`,
        },
      });
      const t = await r.text();
      return { status: r.status, loc: r.headers.get("location") || "", body: t.slice(0, 120) };
    };

    console.log(`  switching active contract -> ${alt.switchContractId} (${alt.label})`);
    const sw = await doSwitch(alt.switchContractId);
    console.log(`    POST status=${sw.status} location=${sw.loc} body=${JSON.stringify(sw.body)}`);

    const afterHtml = await getSessionedHtml(path);
    const afterExport = (afterHtml.match(/href="(\/customer\/\d+\/contract\/(\d+)\/history\/download)"/i) || []);
    const afterContractId = afterExport[2];
    const afterTable = findTableNear(afterHtml, /completed\s*services/i);
    const afterRows = afterTable
      ? extractRows(afterTable.inner).filter((r) => !/<th\b/i.test(r) && extractCells(r).length).length
      : 0;
    const afterLabel = (afterHtml.slice(afterHtml.search(/Selected Contract/i), afterHtml.search(/Selected Contract/i) + 4000)
      .match(/dropdown-toggle[^>]*>([\s\S]*?)<\/a>/i) || [])[1];
    console.log(`    after-switch: table contract id=${afterContractId}, rows=${afterRows}, selected=${JSON.stringify(stripTags(afterLabel || ""))}`);
    console.log(
      `    table contract id changed from ${currentTableContractId} -> ${afterContractId}: ${
        currentTableContractId !== afterContractId ? "YES (switch works, server-side stateful)" : "NO"
      }`
    );

    // Restore the original selection so we don't leave the customer flipped.
    // The original active-contract id isn't directly on the base page, so find
    // it by switching to the contract whose label matches the original selected.
    const originalAltId = contracts.find((c) => c.switchContractId && c.label !== alt.label)?.switchContractId;
    // If original was the *selected* (toggle) one, we must switch back to it.
    // The after-switch page now lists the original mosquito contract as an alt.
    const restoreId =
      (afterHtml.slice(afterHtml.search(/Selected Contract/i), afterHtml.search(/Selected Contract/i) + 4000)
        .match(/active-contract\/(\d+)\/update/i) || [])[1] || originalAltId;
    if (restoreId) {
      const back = await doSwitch(restoreId);
      const restored = await getSessionedHtml(path);
      const restoredId = (restored.match(/contract\/(\d+)\/history\/download/i) || [])[1];
      console.log(`    restored active contract via ${restoreId} (status=${back.status}); table contract id now=${restoredId} (orig=${currentTableContractId})`);
    } else {
      console.log(`    !! could not determine restore id — customer may be left on ${alt.label}. Restore manually.`);
    }
  } else {
    console.log("  (only one contract / no switch link — nothing to switch)");
  }

  console.log(`\n=== Probe done. Inspect ${SAMPLE_PATH} for full markup. ===`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
