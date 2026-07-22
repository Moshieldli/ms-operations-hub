/**
 * LIVE verify of the board v2 fixes (rev 62), 1080p + browser sizes.
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-board-v2.ts [outDir]
 */
import { chromium } from "playwright";

const BASE = "https://ms-operations-hub.vercel.app";

(async () => {
  const outDir = process.argv[2] || ".";
  const browser = await chromium.launch({ headless: true });
  let pass = true;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
    if (!ok) pass = false;
  };
  try {
    // Set the urgent banner for the check, restore after.
    const before = (await (await fetch(`${BASE}/api/board/announcements`)).json()) as {
      thisWeek: string; nextWeek: string; urgent: string;
    };
    await fetch(`${BASE}/api/board/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...before, urgent: "MON MORNING MEETINGS!" }),
    });

    // ---- /tv/board at 1080p ----
    const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await tv.goto(`${BASE}/tv/board`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await tv.waitForTimeout(2500);
    const t = await tv.evaluate(() => document.body.innerText);
    const cols = await tv.evaluate(() => {
      const grid = document.querySelector(".grid-cols-6");
      return grid ? grid.children.length : 0;
    });
    check("6 day columns (Sun→Fri)", cols === 6, `${cols}`);
    check("Sunday column renders", t.includes("Sun"));
    check("Today badge present", /today/i.test(t)); // CSS uppercase → innerText is "TODAY"
    check("week range header", /Week of /.test(t));
    check("URGENT banner renders", t.includes("MON MORNING MEETINGS!"));
    check("announcements seeded (NATURAL)", t.includes("All weekly synthetic services will be NATURAL"));
    check("SERVICE CODES legend", /service codes/i.test(t) && t.includes("weekly / special route"));
    const editingUi = await tv.evaluate(
      () => document.querySelectorAll("textarea, input, select, form").length
    );
    check("ZERO editing UI on /tv/board", editingUi === 0, `${editingUi} form elements`);
    const emoji = await tv.evaluate(() =>
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText)
    );
    check("no emoji (SVG only)", !emoji);
    const clipped = await tv.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll<HTMLElement>(".grid-cols-6 span, .grid-cols-6 div")) {
        if (el.scrollWidth > el.clientWidth + 1) n++;
      }
      return n;
    });
    check("no horizontal clipping in the grid", clipped === 0, `${clipped} clipped`);
    await tv.screenshot({ path: `${outDir}/tv-board-week.png` });
    await tv.close();

    // ---- /service/board (admin mirror) ----
    const sb = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await sb.goto(`${BASE}/service/board`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sb.waitForTimeout(2500);
    const st = await sb.evaluate(() => document.body.innerText);
    check("admin: urgent editor field", /urgent announcement/i.test(st));
    check("admin: announcement editor", st.includes("This week") && st.includes("Next week"));
    check("admin: shout-out form", st.includes("Give a shout-out"));
    await sb.screenshot({ path: `${outDir}/service-board-admin.png`, fullPage: true });

    // ---- ANT marker on the REAL sheet week (Jun 14–19: Cesar "ANT" 6/15,
    //      Nathaniel "608, ANT" 6/16) via the ?week= review override ----
    await sb.goto(`${BASE}/service/board?week=2026-06-14`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Longer settle: a cold sheet read can take several seconds; a timed-out
    // read renders the fallback board and would false-fail the ANT checks.
    await sb.waitForTimeout(4000);
    let at = await sb.evaluate(() => document.body.innerText);
    if (!at.includes("ANT")) {
      await sb.reload({ waitUntil: "domcontentloaded" });
      await sb.waitForTimeout(4000);
      at = await sb.evaluate(() => document.body.innerText);
    }
    check("ANT week loads (review tag)", at.includes("(review)"));
    check("ANT daycode renders (608, ANT)", at.includes("608, ANT"));
    const antIcons = await sb.evaluate(() => {
      // BugIcon strokes rose — count svgs inside route rows with the bug path signature.
      return [...document.querySelectorAll(".grid-cols-6 svg")].filter((s) =>
        (s.innerHTML || "").includes("M12 20a6 6 0 0 0 6-6")
      ).length;
    });
    check("ant BUG marker renders on ANT rows", antIcons >= 1, `${antIcons} bug icons`);
    await sb.screenshot({ path: `${outDir}/service-board-ant-week.png` });
    await sb.close();

    // Restore the urgent banner to its prior value (empty unless ops had set one).
    await fetch(`${BASE}/api/board/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(before),
    });
    console.log("urgent banner restored to prior value");
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
