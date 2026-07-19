/**
 * Verify the shop TVs render ZERO emoji (rev 35).
 *
 * Yodeck's Linux browser has no color-emoji font, so any emoji codepoint that
 * survives to the DOM shows up as an empty box on the actual screen while
 * looking perfect on a dev machine. This asserts on the RENDERED DOM text (and
 * on ::before/::after content, where a stray glyph could hide), counts the
 * inline SVGs that replaced them, and screenshots every size for a human look.
 *
 *   npx tsx scripts/verify-tv-icons.ts [baseUrl]
 */
import { withBrowser } from "./lib/livecheck";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3111";
const OUT = "scratch-tv-icons";

/**
 * Emoji/pictograph ranges. Deliberately EXCLUDES the arrows and dingbat blocks
 * that legitimately appear as text on these boards (—, ·, °) and in comments.
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;

const PAGES = [
  { path: "/tv/techs", sizes: [{ w: 1920, h: 1080, tag: "1080p" }] },
  {
    path: "/tv/techs/tall",
    sizes: [
      { w: 470, h: 430, tag: "slot" },
      { w: 550, h: 700, tag: "mid" },
      { w: 600, h: 900, tag: "max" },
      { w: 1200, h: 600, tag: "wide" },
    ],
  },
];

(async () => {
  mkdirSync(OUT, { recursive: true });
  const fails: string[] = [];

  await withBrowser(async (b) => {
    for (const p of PAGES) {
      for (const s of p.sizes) {
        const page = await b.newPage({ viewport: { width: s.w, height: s.h } });
        await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(3000);

        const tag = `${p.path.replace(/\//g, "_")}@${s.tag}`;

        // 1. No emoji in rendered text, anywhere.
        const text = await page.evaluate(() => document.body.innerText);
        const found = [...new Set(text.match(EMOJI_RE) || [])];
        if (found.length) {
          fails.push(`[${tag}] ${found.length} emoji in DOM text: ${found.join(" ")}`);
        }

        // 2. No emoji hidden in generated content either.
        const pseudo = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const which of ["::before", "::after"]) {
              const c = getComputedStyle(el, which).content;
              if (c && c !== "none" && c !== "normal") out.push(c);
            }
          }
          return out;
        });
        const pFound = [...new Set(pseudo.join(" ").match(EMOJI_RE) || [])];
        if (pFound.length) fails.push(`[${tag}] emoji in ::before/::after: ${pFound.join(" ")}`);

        // 3. The replacements actually rendered.
        const svgs = await page.evaluate(() => document.querySelectorAll("svg").length);
        const expect = p.path === "/tv/techs" ? 7 : 11; // 6 awards + ticker (+4 weather on tall)
        if (svgs < expect) fails.push(`[${tag}] only ${svgs} inline SVGs, expected >= ${expect}`);

        // 4. Nothing clipped or overflowing (a TV widget cannot scroll).
        const overflow = await page.evaluate(() => ({
          doc:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
            document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
          tiles: Array.from(document.querySelectorAll("[data-award-tile]")).filter(
            (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1
          ).length,
        }));
        if (overflow.doc) fails.push(`[${tag}] document overflows`);
        if (overflow.tiles) fails.push(`[${tag}] ${overflow.tiles} award tiles clipped`);

        await page.screenshot({ path: `${OUT}/${tag}.png` });
        console.log(
          `[${tag}] emoji=${found.length} pseudo=${pFound.length} svgs=${svgs} ` +
            `clippedTiles=${overflow.tiles} docOverflow=${overflow.doc}`
        );
        await page.close();
      }
    }
  });

  if (fails.length) {
    console.log("\n=== TV ICONS VERIFY FAIL ===");
    for (const f of fails) console.log(" x " + f);
    process.exit(1);
  }
  console.log(`\n=== TV ICONS VERIFY PASS === (screenshots in ${OUT}/)`);
})();
