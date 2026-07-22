/**
 * LIVE verify of the rev-59 nav taxonomy (real browser — dropdown children
 * don't exist in the DOM until clicked, so this can't be curl).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-nav-taxonomy.ts [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "https://ms-operations-hub.vercel.app";

(async () => {
  const browser = await chromium.launch({ headless: true });
  let pass = true;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
    if (!ok) pass = false;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);

    // Top-bar labels, in order.
    const navText = await page.evaluate(
      () => document.querySelector("header nav")?.textContent ?? ""
    );
    const expectedOrder = ["Customers", "Leads", "Service", "Finance", "Texting", "Requests", "TV"];
    let idx = 0;
    let ordered = true;
    for (const label of expectedOrder) {
      const at = navText.indexOf(label, idx);
      if (at < 0) {
        ordered = false;
        break;
      }
      idx = at + label.length;
    }
    check("top bar order Customers·Leads·Service·Finance·Texting·Requests·TV", ordered, navText.trim());
    check("no Calling tab", !navText.includes("Calling"));
    check("no Combined tab", !navText.includes("Combined"));
    check("no bare Sales tab", !/Sales(?! board)/.test(navText));

    // Customers is a plain LINK to /sales and is active here.
    const customers = await page.evaluate(() => {
      const a = [...document.querySelectorAll("header nav a")].find(
        (el) => el.textContent?.trim() === "Customers"
      ) as HTMLAnchorElement | undefined;
      return a
        ? { href: a.getAttribute("href"), active: a.className.includes("bg-foreground") }
        : null;
    });
    check("Customers is a plain link to /sales", customers?.href === "/sales");
    check("Customers active on /sales", Boolean(customers?.active));

    // Service dropdown children.
    await page.getByRole("button", { name: "Service" }).click();
    await page.waitForTimeout(400);
    const svcMenu = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] a')].map((a) => ({
        label: a.textContent?.trim(),
        href: a.getAttribute("href"),
      }))
    );
    check(
      "Service → Overdue sprays / Respray performance / Route board",
      JSON.stringify(svcMenu.map((m) => m.label)) ===
        JSON.stringify(["Overdue sprays", "Respray performance", "Route board"]),
      JSON.stringify(svcMenu)
    );
    await page.keyboard.press("Escape");

    // TV dropdown: 4 boards incl /tv/board, all new-tab.
    await page.getByRole("button", { name: "TV" }).click();
    await page.waitForTimeout(400);
    const tvMenu = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] a')].map((a) => ({
        label: a.textContent?.trim(),
        href: a.getAttribute("href"),
        blank: a.getAttribute("target") === "_blank" && (a.getAttribute("rel") || "").includes("noopener"),
      }))
    );
    check(
      "TV → 4 boards incl /tv/board",
      tvMenu.length === 4 && tvMenu.some((m) => m.href === "/tv/board"),
      JSON.stringify(tvMenu.map((m) => `${m.label}:${m.href}`))
    );
    check("all TV items new-tab + noopener", tvMenu.every((m) => m.blank));
    await page.keyboard.press("Escape");

    // /finance: ONLY the Finance tab is active (no double-highlight).
    await page.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1200);
    const activeTabs = await page.evaluate(() =>
      [...document.querySelectorAll("header nav a, header nav button")]
        .filter((el) => el.className.includes("bg-foreground"))
        .map((el) => el.textContent?.trim())
    );
    check("only Finance active on /finance", JSON.stringify(activeTabs) === JSON.stringify(["Finance"]), JSON.stringify(activeTabs));

    // Redirects.
    await page.goto(`${BASE}/combined`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    check("/combined → /sales", page.url().replace(/\/$/, "").endsWith("/sales"), page.url());
    await page.goto(`${BASE}/calling`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    check("/calling → /leads", page.url().replace(/\/$/, "").endsWith("/leads"), page.url());
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
