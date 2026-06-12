/**
 * READ-ONLY: dump the unpaid_search_terms form, submit it (raw POST → HTML),
 * and inspect the returned report so we can parse per-customer balances.
 * A search POST only reads. No mutation.
 */
import { getSessionedHtml, getPocomosSession, pocomosWebBase } from "../src/lib/pocomos/webSession";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

async function rawPost(path: string, body: URLSearchParams, referer: string): Promise<string> {
  const cookie = await getPocomosSession();
  const resp = await fetch(`${pocomosWebBase()}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,*/*",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie,
      Referer: `${pocomosWebBase()}${referer}`,
      "User-Agent": "ms-operations-hub-sync/1.0",
    },
    body: body.toString(),
    cache: "no-store",
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status}: ${text.slice(0, 200)}`);
  return text;
}

(async () => {
  const html = await getSessionedHtml("/finance/unpaid");
  const fi = html.indexOf('id="unpaid_search_terms"');
  const formEnd = html.indexOf("</form>", fi);
  const form = html.slice(fi - 300, formEnd + 7);

  console.log("=== form fields ===");
  for (const m of form.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]*)"/) || [])[1] ?? "";
    const type = (tag.match(/type="([^"]*)"/) || [])[1] ?? m[1];
    const value = (tag.match(/value="([^"]*)"/) || [])[1] ?? "";
    const checked = /checked/i.test(tag) ? " CHECKED" : "";
    if (name) console.log(`  ${String(type).padEnd(9)} ${name} = "${value}"${checked}`);
  }
  console.log("\n=== selects ===");
  for (const sel of form.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const selOpt = sel[2].match(/<option\b[^>]*selected[^>]*value="([^"]*)"/i);
    const opts = Array.from(sel[2].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi))
      .map((o) => `${o[1]}:${stripTags(o[2])}`).slice(0, 8);
    console.log(`  ${sel[1]}: selected=${selOpt ? selOpt[1] : "(none)"} opts=[${opts.join(" | ")}]`);
  }

  // Build submission from all defaults.
  const body = new URLSearchParams();
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]*)"/) || [])[1];
    if (!name) continue;
    const type = (tag.match(/type="([^"]*)"/) || [])[1] ?? "text";
    const value = (tag.match(/value="([^"]*)"/) || [])[1] ?? "";
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) body.set(name, value || "1");
    } else body.set(name, value);
  }
  for (const sel of form.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const selOpt = sel[2].match(/<option\b[^>]*selected[^>]*value="([^"]*)"/i);
    const first = sel[2].match(/<option\b[^>]*value="([^"]+)"/i);
    body.set(sel[1], selOpt ? selOpt[1] : first ? first[1] : "");
  }

  // Force a full open-balance pull: all aging buckets on, status=Unpaid,
  // branch=office, wide date range.
  body.set("unpaid_search_terms[lessThan30]", "1");
  body.set("unpaid_search_terms[thirtyTo60]", "1");
  body.set("unpaid_search_terms[sixtyTo90]", "1");
  body.set("unpaid_search_terms[moreThan90]", "1");
  body.set("unpaid_search_terms[status]", "Unpaid");
  body.set("unpaid_search_terms[branches][]", "1512");
  body.set("unpaid_search_terms[reminderSearchTermsType][searchTermsType][dates][dateStart]", "01/01/2020");
  body.set("unpaid_search_terms[reminderSearchTermsType][searchTermsType][dates][dateEnd]", "12/31/2026");

  console.log("\n=== submitting (all aging buckets, status=Unpaid, wide dates) ===");

  const out = await rawPost("/finance/unpaid-data", body, "/finance/unpaid");
  console.log("\n=== report HTML: " + out.length + " bytes ===");
  const thead = out.match(/<thead[\s\S]*?<\/thead>/i);
  if (thead) {
    const ths = Array.from(thead[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((m, i) => `${i}:"${stripTags(m[1])}"`);
    console.log("THEAD:", ths.join("  "));
  }
  // dollar amounts anywhere
  const dollars = Array.from(out.matchAll(/\$[\d,]+\.\d{2}/g)).map((m) => m[0]);
  console.log("dollar amounts seen:", dollars.slice(0, 12).join(" "), `(total ${dollars.length})`);

  const tb = out.match(/<tbody[\s\S]*?<\/tbody>/i);
  if (tb) {
    const trs = Array.from(tb[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
    console.log(`tbody rows: ${trs.length}`);
    for (const tr of trs.slice(0, 4)) {
      console.log("\n  --- RAW ROW HTML ---\n  " + tr[1].replace(/\s+/g, " ").trim().slice(0, 900));
      const tds = Array.from(tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((c, i) => `${i}="${stripTags(c[1])}"`);
      const cust = (tr[1].match(/\/customer\/(\d+)/) || [])[1];
      console.log(`  cust=${cust ?? "?"} :: ${tds.join("  ")}`);
    }
  } else {
    console.log("no <tbody>; sniff first 800:", out.slice(0, 800).replace(/\s+/g, " "));
  }
})().catch((e) => {
  console.error("FAILED:", (e as Error).message.slice(0, 300));
  process.exit(1);
});
