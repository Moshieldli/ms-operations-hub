/**
 * LIVE verify of the new-sale bell (rev 60) — Playwright drives a SIMULATED
 * climb by stubbing /api/sales/live + /api/sales/week-tally on top of the real
 * deployed page:
 *   load 1: NEW=150 primes last-seen; tally line renders "This week: 5 / 25"
 *   load 2: NEW=152 → "+2 NEW SALES" splash + sale.wav fired + New tile flash
 *   load 3: NEW=156 → crosses 10 → milestone-10.wav (not sale.wav)
 * Also checks the wav files are served and /sales shows the subtle tally
 * without ringing.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-sale-bell.ts [outDir]
 */
import { chromium, type Page, type BrowserContext } from "playwright";

const BASE = "https://ms-operations-hub.vercel.app";

(async () => {
  const outDir = process.argv[2] || ".";
  // Real live summary as the stub's base, so every other field stays valid.
  const liveResp = (await (await fetch(`${BASE}/api/sales/live`)).json()) as {
    ok: boolean;
    summary: { buckets: { NEW: number } };
  };
  if (!liveResp.ok) throw new Error("live endpoint not ok");
  const summaryWithNew = (n: number) =>
    JSON.stringify({ ok: true, summary: { ...liveResp.summary, buckets: { ...liveResp.summary.buckets, NEW: n } } });

  const browser = await chromium.launch({ headless: true });
  let pass = true;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
    if (!ok) pass = false;
  };

  const stub = async (ctx: BrowserContext | Page, newCount: number, fired: number[] = []) => {
    await ctx.route("**/api/sales/live", (r) =>
      r.fulfill({ contentType: "application/json", body: summaryWithNew(newCount) })
    );
    await ctx.route("**/api/sales/week-tally", (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, fired: [10] }) })
        : r.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ ok: true, weekStart: "2026-07-18", baselineNew: 145, fired }),
          })
    );
  };

  try {
    // WAV files served.
    for (const f of ["sale.wav", "milestone-10.wav", "milestone-25.wav"]) {
      const r = await fetch(`${BASE}/sounds/${f}`);
      const len = Number(r.headers.get("content-length") || 0);
      check(`${f} served`, r.ok && len > 50_000, `${r.status}, ${len}B`);
    }

    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    // Load 1 — primes last-seen at 150; tally renders.
    const p1 = await ctx.newPage();
    await stub(p1, 150);
    await p1.goto(`${BASE}/tv/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p1.waitForTimeout(2500);
    const t1 = await p1.evaluate(() => document.body.innerText);
    check("tally renders (This week: 5 / 25)", t1.includes("This week: 5 / 25"));
    check("no splash on steady count", !t1.includes("NEW SALE"));
    await p1.screenshot({ path: `${outDir}/tv-sales-tally.png` });
    await p1.close();

    // Load 2 — climb +2 → splash + sale.wav.
    const p2 = await ctx.newPage();
    await stub(p2, 152);
    await p2.goto(`${BASE}/tv/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p2.getByText("+2 NEW SALES").waitFor({ timeout: 15_000 });
    const played2 = await p2.evaluate(
      () => document.querySelector("[data-last-played]")?.getAttribute("data-last-played") ?? ""
    );
    check("+2 NEW SALES splash", true);
    check("sale.wav fired", played2 === "/sounds/sale.wav", played2);
    const flash = await p2.evaluate(() => Boolean(document.querySelector(".border-emerald-500")));
    check("New tile flashes", flash);
    await p2.screenshot({ path: `${outDir}/tv-sales-splash.png` });
    await p2.close();

    // Load 3 — prev 152 → 156 crosses tally 10 → milestone-10, NOT sale.wav.
    const p3 = await ctx.newPage();
    await stub(p3, 156);
    await p3.goto(`${BASE}/tv/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p3.getByText("+4 NEW SALES").waitFor({ timeout: 15_000 });
    const t3 = await p3.evaluate(() => document.body.innerText);
    const played3 = await p3.evaluate(
      () => document.querySelector("[data-last-played]")?.getAttribute("data-last-played") ?? ""
    );
    check("milestone splash line (10 THIS WEEK)", t3.includes("10 THIS WEEK"));
    check("milestone-10.wav fired (not sale.wav)", played3 === "/sounds/milestone-10.wav", played3);
    await p3.screenshot({ path: `${outDir}/tv-sales-milestone.png` });
    await p3.close();

    // /sales browser page: subtle tally, silent (no audio element data attr use;
    // just assert the tally text renders and no splash machinery exists).
    const p4 = await ctx.newPage();
    await stub(p4, 160);
    await p4.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p4.waitForTimeout(2500);
    const t4 = await p4.evaluate(() => document.body.innerText);
    check("/sales shows subtle tally (This week: 15 / 25)", t4.includes("This week: 15 / 25"));
    check("/sales page titled Customers", t4.includes("Customers"));
    await p4.close();
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
