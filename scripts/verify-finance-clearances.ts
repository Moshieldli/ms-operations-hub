/**
 * LIVE verify for the /finance cash-register moment (rev 55) — real browser,
 * not curl+regex. Seeds a FAKE clearance row (no real payment existed at ship
 * time), points a browser whose last-seen marker is 1h old at production,
 * asserts the celebration + Collections-Mode controls render, screenshots,
 * then deletes the seed row.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-finance-clearances.ts [outDir]
 */
import { chromium } from "playwright";
import { initSchema, sql } from "../src/lib/db";

const BASE = "https://ms-operations-hub.vercel.app";
const TEST_ID = "TEST-VERIFY-CLEAR";

(async () => {
  const outDir = process.argv[2] || ".";
  await initSchema();
  await sql`DELETE FROM balance_clearances WHERE pocomos_id = ${TEST_ID}`;
  await sql`
    INSERT INTO balance_clearances (pocomos_id, full_name, amount_cleared, source)
    VALUES (${TEST_ID}, ${"Verify Person"}, ${412.0}, ${"collections"})
  `;
  console.log("seeded fake clearance ($412 — Verify Person)");

  const browser = await chromium.launch({ headless: true });
  let pass = true;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    await ctx.addInitScript(
      ([marker]) => {
        localStorage.setItem("ms_clearance_seen", marker);
        localStorage.setItem("ms_register_muted", "0");
      },
      [hourAgo]
    );
    const page = await ctx.newPage();
    await page.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1400); // hydration + the clearances fetch
    await page.screenshot({ path: `${outDir}/finance-celebration.png` });

    const body = await page.evaluate(() => document.body.innerText);
    const checks: Array<[string, boolean]> = [
      ["collected line", body.includes("Collected $412.00 since you last looked (1 customer)")],
      ["session button", body.includes("Start collections session")],
      ["paused card", body.includes("Service paused — open balance")],
    ];
    for (const [name, ok] of checks) {
      console.log(`${ok ? "✓" : "✗"} ${name}`);
      if (!ok) pass = false;
    }
    // Flyer text ("+$412.00 — Verify P.") is transient — assert it appeared in
    // the DOM at some point via a fresh reload caught earlier in its animation.
    const page2 = await ctx.newPage();
    await ctx.addInitScript(
      ([marker]) => localStorage.setItem("ms_clearance_seen", marker),
      [hourAgo]
    );
    await page2.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    try {
      await page2.getByText("Verify P.", { exact: false }).first().waitFor({ timeout: 5000 });
      console.log("✓ flying amount rendered (+$412.00 — Verify P.)");
      await page2.screenshot({ path: `${outDir}/finance-flyer.png` });
    } catch {
      console.log("✗ flying amount not observed");
      pass = false;
    }

    // Start a session and confirm the live state + tally line render.
    await page.getByText("Start collections session", { exact: false }).first().click();
    await page.waitForTimeout(800);
    const body2 = await page.evaluate(() => document.body.innerText);
    const sessionOk =
      body2.includes("Session live") && body2.includes("This session: $0.00 · 0 customers");
    console.log(`${sessionOk ? "✓" : "✗"} collections session live + tally`);
    if (!sessionOk) pass = false;
    await page.screenshot({ path: `${outDir}/finance-session.png` });
  } finally {
    await browser.close();
    await sql`DELETE FROM balance_clearances WHERE pocomos_id = ${TEST_ID}`;
    console.log("seed row deleted");
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
