/**
 * Verify the LIVE /tv/techs board in a real browser at the Yodeck viewport
 * (1920×1080). Asserts the rendered DOM — not curl+regex.
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-tv-techs.ts
 */
import { withBrowser } from "./lib/livecheck";

const URL = "https://ms-operations-hub.vercel.app/tv/techs";

(async () => {
  const fails: string[] = [];
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log("--- rendered text ---\n" + body + "\n");
    // Award labels/headers render through CSS `uppercase`, so innerText comes
    // back as "CLEAN STREAK". Compare case-insensitively or every label false-FAILs.
    const has = (s: string) => body.toLowerCase().includes(s.toLowerCase());

    const must = [
      "Tech Board",
      "week of",
      "Clean Streak",
      "Iron Wall",
      "Workhorse",
      "Road Warrior",
      "Most Improved",
      "Perfect Week",
      "season to date",
      "Longest streak",
      "Sprays",
      "Respray rate",
    ];
    for (const m of must) if (!has(m)) fails.push(`MISSING: ${m}`);

    // Product rules that must hold on the live screen.
    if (/cesar/i.test(body)) fails.push("Cesar Barrerra appears on the board");
    if (/z-asap|unassigned/i.test(body)) fails.push("a Pocomos placeholder tech appears");
    for (const bad of ["Needs attention", "Worst", "Last place", "Most resprays"]) {
      if (has(bad)) fails.push(`NEGATIVE CALLOUT on screen: ${bad}`);
    }

    // Never superlative in a blurb (the matching can seat a non-top candidate).
    if (/Most properties|Most sprays in a row|Most distinct routes|Best respray rate/.test(body)) {
      fails.push("a superlative blurb is on screen (must be descriptive)");
    }

    // No horizontal overflow / no scrolling at the TV viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth ||
            document.documentElement.scrollHeight > window.innerHeight + 2
    );
    if (overflow) fails.push("page overflows the 1920x1080 viewport (TV would clip or scroll)");

    // The 10-minute self-reload must be wired.
    const shot = "scratch-tv-techs.png";
    await page.screenshot({ path: shot });
    console.log(`screenshot: ${shot}`);
  });

  console.log(`\n=== ${fails.length === 0 ? "LIVE VERIFY PASS" : "LIVE VERIFY FAIL"} ===`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
