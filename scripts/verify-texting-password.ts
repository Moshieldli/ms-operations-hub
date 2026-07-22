/**
 * LIVE verify (rev 58): texting gate rejects the OLD password, accepts the NEW.
 * Reads neither from the repo — old/new are passed as argv so no secret lands
 * in a committed file beyond this one-time check.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-texting-password.ts <old> <new>
 */
import { chromium } from "playwright";

const BASE = "https://ms-operations-hub.vercel.app";

(async () => {
  const [oldPw, newPw] = process.argv.slice(2);
  if (!oldPw || !newPw) {
    console.error("usage: verify-texting-password.ts <old> <new>");
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true });
  let pass = true;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) pass = false;
  };
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Unauthed /texting redirects to the login page.
    await page.goto(`${BASE}/texting`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1200);
    check("unauthed → login screen", page.url().includes("/texting/login"));

    // OLD password → rejected (stays on login / error shown).
    await page.locator('input[type="password"]').fill(oldPw);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1800);
    check("old password rejected", page.url().includes("/texting/login"));

    // NEW password → accepted (lands on /texting).
    await page.locator('input[type="password"]').fill(newPw);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    check("new password accepted", !page.url().includes("/texting/login"));
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
