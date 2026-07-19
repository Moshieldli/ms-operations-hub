/**
 * Verify /tv/techs/tall in a real browser across the Yodeck size range.
 * Screenshots the small and large extremes and asserts the layout never
 * overflows (a TV widget cannot scroll).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-tv-techs-tall.ts [baseUrl]
 */
import { withBrowser } from "./lib/livecheck";

const BASE = process.argv[2] || "https://ms-operations-hub.vercel.app";
const URL = `${BASE}/tv/techs/tall`;

/** The stated Yodeck range, plus a mid size. */
const SIZES = [
  { w: 500, h: 450, tag: "min" },
  { w: 550, h: 700, tag: "mid" },
  { w: 600, h: 900, tag: "max" },
];

(async () => {
  const fails: string[] = [];
  await withBrowser(async (browser) => {
    for (const s of SIZES) {
      const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
      await page.goto(URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const has = (t: string) => body.toLowerCase().includes(t.toLowerCase());
      console.log(`\n=== ${s.tag} ${s.w}x${s.h} ===\n${body}`);

      // Content that must survive at EVERY size (the priority-order contract).
      for (const m of ["Tech Board", "Week of", "sprays", "team rate", "in a row"]) {
        if (!has(m)) fails.push(`[${s.tag}] MISSING: ${m}`);
      }
      // All six award winners, by first name.
      const firsts = ["Josef", "Jason", "Nathaniel", "Nicholas", "Daniel"];
      for (const f of firsts) if (!has(f)) fails.push(`[${s.tag}] MISSING award name: ${f}`);
      // Weather strip: at least a temperature and a precip chance.
      if (!/\d+°/.test(body)) fails.push(`[${s.tag}] weather strip has no temperature`);
      if (!/💧\s?\d+%/.test(body)) fails.push(`[${s.tag}] weather strip has no precip chance`);
      if (!has("Today")) fails.push(`[${s.tag}] weather strip has no Today column`);

      // Product rules.
      if (/cesar/i.test(body)) fails.push(`[${s.tag}] Cesar appears`);
      if (/z-asap|unassigned/i.test(body)) fails.push(`[${s.tag}] placeholder tech appears`);
      for (const bad of ["Needs attention", "Worst", "Last place"]) {
        if (has(bad)) fails.push(`[${s.tag}] NEGATIVE CALLOUT: ${bad}`);
      }

      // A TV widget cannot scroll — nothing may overflow at any size.
      const over = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth > window.innerWidth + 1,
        y: document.documentElement.scrollHeight > window.innerHeight + 1,
      }));
      if (over.x) fails.push(`[${s.tag}] horizontal overflow`);
      if (over.y) fails.push(`[${s.tag}] vertical overflow (content would be cut off)`);

      await page.screenshot({ path: `scratch-tall-${s.tag}.png` });
      await page.close();
    }
  });

  console.log(`\n=== ${fails.length === 0 ? "TALL VERIFY PASS" : "TALL VERIFY FAIL"} ===`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
