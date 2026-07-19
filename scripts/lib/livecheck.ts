/**
 * Live-page checks via Playwright (a real browser) — NOT curl + regex.
 *
 * WHY: verifying deployed UI with `curl | grep` gives false FAILs, because the
 * SSR HTML differs from what a user sees: React inserts `<!-- -->` comment nodes
 * between text and interpolated values, renders en-dashes/entities, orders
 * attributes unpredictably, and — critically — collapsible/dropdown children
 * only appear AFTER a click. A headless browser sees the rendered DOM and can
 * click, so these checks match reality. (Our en-dash and attribute-order
 * false-FAIL history is exactly why this exists.)
 *
 * Usage:
 *   import { checkLivePage, withBrowser } from "./lib/livecheck";
 *   const r = await checkLivePage("https://…/sales", {
 *     clickText: "Leads",              // open the dropdown
 *     expectText: ["Close rate", "Follow-ups"],
 *   });
 *   console.log(r.ok ? "PASS" : "FAIL", r.details);
 */
import { chromium, type Browser, type Page } from "playwright";

export interface LiveCheckOptions {
  /** Click the first element whose visible text matches this, before asserting. */
  clickText?: string;
  /** A CSS/text selector to click instead of clickText (takes precedence). */
  clickSelector?: string;
  /** Strings that MUST be present in the rendered page after the (optional) click. */
  expectText?: string[];
  /** Strings that must NOT be present. */
  absentText?: string[];
  /** ms to wait after load / click for hydration + client render (default 2500). */
  settleMs?: number;
  /**
   * Load-state to wait for (default "domcontentloaded"). NOT "networkidle" —
   * several pages background-poll (useLiveSales) so the network never idles.
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export interface LiveCheckResult {
  ok: boolean;
  url: string;
  status: number | null;
  details: string[];
}

/** Run `fn` with a shared headless Chromium, always cleaning up. */
export async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Load a URL in a real browser, optionally click, and assert rendered text. */
export async function checkLivePage(
  url: string,
  opts: LiveCheckOptions = {},
  browser?: Browser
): Promise<LiveCheckResult> {
  const run = async (b: Browser): Promise<LiveCheckResult> => {
    const page: Page = await b.newPage();
    const details: string[] = [];
    let status: number | null = null;
    try {
      const resp = await page.goto(url, { waitUntil: opts.waitUntil ?? "domcontentloaded", timeout: 45_000 });
      status = resp?.status() ?? null;
      await page.waitForTimeout(opts.settleMs ?? 2500);

      if (opts.clickSelector) {
        await page.click(opts.clickSelector, { timeout: 10_000 });
        await page.waitForTimeout(600);
      } else if (opts.clickText) {
        // getByText matches rendered text (handles en-dashes/entities/comment nodes).
        await page.getByText(opts.clickText, { exact: false }).first().click({ timeout: 10_000 });
        await page.waitForTimeout(600);
      }

      const body = await page.evaluate(() => document.body.innerText);
      let ok = status !== null && status < 400;
      if (status === null || status >= 400) details.push(`HTTP status ${status}`);

      for (const needle of opts.expectText ?? []) {
        const found = body.includes(needle);
        details.push(`${found ? "✓" : "✗"} present: ${JSON.stringify(needle)}`);
        if (!found) ok = false;
      }
      for (const needle of opts.absentText ?? []) {
        const absent = !body.includes(needle);
        details.push(`${absent ? "✓" : "✗"} absent: ${JSON.stringify(needle)}`);
        if (!absent) ok = false;
      }
      return { ok, url, status, details };
    } finally {
      await page.close();
    }
  };
  return browser ? run(browser) : withBrowser(run);
}

/** CLI: `node … scripts/lib/livecheck.ts <url> [clickText] [expect1] [expect2] …` */
if (process.argv[1] && /livecheck\.ts$/.test(process.argv[1])) {
  const [url, clickText, ...expect] = process.argv.slice(2);
  if (!url) {
    console.error("usage: livecheck.ts <url> [clickText] [expectText...]");
    process.exit(2);
  }
  checkLivePage(url, { clickText: clickText || undefined, expectText: expect })
    .then((r) => {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.url} (HTTP ${r.status})`);
      for (const d of r.details) console.log(`   ${d}`);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error("livecheck error:", e);
      process.exit(2);
    });
}
