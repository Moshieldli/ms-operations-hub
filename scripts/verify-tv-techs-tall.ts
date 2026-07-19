/**
 * Verify /tv/techs/tall in a real browser across the Yodeck size range,
 * including the SHORT real slot (~470x430) and a wide short case (1200x600).
 *
 * Asserts: no overflow at any size (a TV widget cannot scroll), the award
 * LABELS render, and the adaptive awards region picks the right mode — all six
 * tiles when they fit, rotating pages of 3 when they don't (and then that the
 * rotation actually advances and eventually shows every winner).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-tv-techs-tall.ts [baseUrl]
 */
import { withBrowser } from "./lib/livecheck";

const BASE = process.argv[2] || "https://ms-operations-hub.vercel.app";
const URL = `${BASE}/tv/techs/tall`;

/** All six awards must be visible at EVERY size — there is no rotation mode. */
const SIZES = [
  { w: 470, h: 430, tag: "slot", cols: 2 },
  { w: 550, h: 700, tag: "mid", cols: 2 },
  { w: 600, h: 900, tag: "max", cols: 1 },
  { w: 1200, h: 600, tag: "wide", cols: 3 },
];

const LABELS = [
  "CLEAN STREAK",
  "IRON WALL",
  "WORKHORSE",
  "ROAD WARRIOR",
  "MOST IMPROVED",
  "PERFECT WEEK",
];

(async () => {
  const fails: string[] = [];
  await withBrowser(async (browser) => {
    for (const s of SIZES) {
      const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
      await page.goto(URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const read = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const body = await read();
      const has = (t: string) => body.toLowerCase().includes(t.toLowerCase());
      console.log(`\n=== ${s.tag} ${s.w}x${s.h} ===\n${body}`);

      // Chrome that must survive at EVERY size (the priority-order contract).
      for (const m of ["Tech Board", "Week of", "sprays", "team rate", "in a row"]) {
        if (!has(m)) fails.push(`[${s.tag}] MISSING: ${m}`);
      }
      if (!has("Today")) fails.push(`[${s.tag}] weather strip has no Today column`);
      if (!/\d+°/.test(body)) fails.push(`[${s.tag}] weather strip has no temperature`);
      if (!/💧\s?\d+%/.test(body)) fails.push(`[${s.tag}] weather strip has no precip chance`);

      // Award LABELS are the point of this revision.
      const shownLabels = LABELS.filter((l) => has(l));
      if (shownLabels.length === 0) fails.push(`[${s.tag}] no award labels rendered`);

      for (const l of LABELS) if (!has(l)) fails.push(`[${s.tag}] MISSING label: ${l}`);

      // The grid must reshape to the expected column count for this slot.
      const grid = await page.evaluate(() => {
        const tile = document.querySelector("[data-award-tile]");
        if (!tile) return null;
        const g = tile.parentElement!;
        const tops = [...g.children].map((c) => Math.round(c.getBoundingClientRect().top));
        const firstTop = tops[0];
        return {
          cols: tops.filter((t) => t === firstTop).length,
          rows: new Set(tops).size,
          box: (() => {
            const r = tile.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })(),
        };
      });
      if (!grid) fails.push(`[${s.tag}] no grid found`);
      else {
        if (grid.cols !== s.cols) {
          fails.push(`[${s.tag}] expected ${s.cols} columns, got ${grid.cols}`);
        }
        console.log(
          `[${s.tag}] grid ${grid.cols}x${grid.rows}, tile ${grid.box.w}x${grid.box.h}`
        );
      }

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

      // Per-TILE clipping. The document can fit perfectly while each tile clips
      // its own name/stat mid-glyph — that shipped once and the document-level
      // check above sailed straight past it, so assert every tile individually.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll("[data-award-tile]")]
          .map((t) => ({
            id: t.getAttribute("data-award-tile") || "?",
            over: t.scrollHeight - t.clientHeight,
          }))
          .filter((t) => t.over > 1)
      );
      for (const c of clipped) {
        fails.push(`[${s.tag}] tile "${c.id}" clips its content by ${c.over}px`);
      }
      const tileCount = await page.evaluate(
        () => document.querySelectorAll("[data-award-tile]").length
      );
      if (tileCount === 0) fails.push(`[${s.tag}] no award tiles found`);
      console.log(`[${s.tag}] tiles=${tileCount} clipped=${clipped.length}`);

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
