/**
 * LIVE verify (rev 61): the /finance collections CTA idle + LIVE states.
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-collect-cta.ts [outDir]
 */
import { chromium } from "playwright";

const BASE = "https://ms-operations-hub.vercel.app";

(async () => {
  const outDir = process.argv[2] || ".";
  const browser = await chromium.launch({ headless: true });
  let pass = true;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) pass = false;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    const cta = page.locator(".ms-collect-cta");
    check("idle CTA renders", await cta.isVisible());
    const body1 = await page.evaluate(() => document.body.innerText);
    check(
      "idle CTA copy (audio-neutral sub-line)",
      body1.includes("Start collections session") &&
        body1.includes("Track payments as they land") &&
        !body1.includes("Ring the register")
    );
    await page.screenshot({ path: `${outDir}/finance-cta-idle.png` });

    await cta.click();
    await page.waitForTimeout(1000);
    const body2 = await page.evaluate(() => document.body.innerText);
    check("LIVE panel renders", body2.includes("Collections session LIVE"));
    check("running tally", /This session: \$0\.00 · 0 customers/.test(body2));
    check("separate Stop button", await page.getByRole("button", { name: "Stop" }).isVisible());
    await page.screenshot({ path: `${outDir}/finance-cta-live.png` });

    await page.getByRole("button", { name: "Stop" }).click();
    await page.waitForTimeout(600);
    check("stop returns to idle CTA", await cta.isVisible());
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
