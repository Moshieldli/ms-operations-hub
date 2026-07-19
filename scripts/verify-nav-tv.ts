/**
 * Verify the TV nav dropdown: the tab exists, opens on CLICK (not hover, so it
 * works on touch), lists all three boards, and every item opens in a NEW TAB
 * (TV pages render without the nav — an in-tab link would strand the user).
 */
import { withBrowser } from "./lib/livecheck";

const BASE = process.argv[2] || "http://localhost:3111";
const EXPECT = [
  { label: "Sales board", href: "/tv/sales" },
  { label: "Tech board", href: "/tv/techs" },
  { label: "Tech board — narrow", href: "/tv/techs/tall" },
];

(async () => {
  const fails: string[] = [];
  await withBrowser(async (b) => {
    const page = await b.newPage();
    await page.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);

    // Closed by default — children must not be in the DOM before the click.
    const before = await page.evaluate(() => document.body.innerText);
    if (before.includes("Sales board")) fails.push("dropdown was already open before click");

    const tab = page.locator('nav button:has-text("TV")');
    if ((await tab.count()) !== 1) fails.push(`expected 1 TV tab button, found ${await tab.count()}`);
    await tab.first().click({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] a')].map((a) => ({
        text: (a as HTMLElement).innerText.trim(),
        href: new URL((a as HTMLAnchorElement).href).pathname,
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      }))
    );
    console.log("menu items:", JSON.stringify(items, null, 2));

    for (const e of EXPECT) {
      const hit = items.find((i) => i.href === e.href);
      if (!hit) { fails.push(`MISSING item ${e.href}`); continue; }
      if (hit.text !== e.label) fails.push(`${e.href}: label "${hit.text}" != "${e.label}"`);
      if (hit.target !== "_blank") fails.push(`${e.href}: target="${hit.target}", expected _blank`);
      if (!(hit.rel || "").includes("noopener")) fails.push(`${e.href}: rel="${hit.rel}" missing noopener`);
    }

    // Escape closes it.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if ((await page.locator('[role="menu"]').count()) > 0) fails.push("Escape did not close the dropdown");

    // The existing tabs must not have regressed: /finance lights Finance only.
    const active = await page.evaluate(() =>
      [...document.querySelectorAll("nav a, nav button")]
        .filter((el) => el.className.includes("bg-foreground"))
        .map((el) => (el as HTMLElement).innerText.trim())
    );
    console.log("active tabs on /finance:", JSON.stringify(active));
    if (active.length !== 1 || active[0] !== "Finance") {
      fails.push(`expected only "Finance" active on /finance, got ${JSON.stringify(active)}`);
    }

    await page.close();
  });

  if (fails.length) {
    console.log("\n=== NAV TV VERIFY FAIL ===");
    for (const f of fails) console.log(" ✗ " + f);
    process.exit(1);
  }
  console.log("\n=== NAV TV VERIFY PASS ===");
})();
