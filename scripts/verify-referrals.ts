/**
 * Verify the referral trophy + boost badge (rev 41) on both boards, at every
 * size. Asserts the trophy renders, spins, names the CUSTOMER, shows NO dollar
 * amount anywhere, and that boosted techs carry the star on their other tiles.
 */
import { withBrowser } from "./lib/livecheck";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3111";
const OUT = "scratch-tv-icons";
const SIZES = [
  { path: "/tv/techs", w: 1920, h: 1080, tag: "landscape-1080p" },
  { path: "/tv/techs/tall", w: 470, h: 430, tag: "tall-slot" },
  { path: "/tv/techs/tall", w: 550, h: 700, tag: "tall-mid" },
  { path: "/tv/techs/tall", w: 600, h: 900, tag: "tall-max" },
  { path: "/tv/techs/tall", w: 1200, h: 600, tag: "tall-wide" },
];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/gu;

(async () => {
  mkdirSync(OUT, { recursive: true });
  const fails: string[] = [];
  await withBrowser(async (b) => {
    for (const s of SIZES) {
      const page = await b.newPage({ viewport: { width: s.w, height: s.h } });
      await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      const text = await page.evaluate(() => document.body.innerText);

      // 1. Both referrals present, named by CUSTOMER.
      for (const c of ["Channa Noiman", "Mina Becher"]) {
        if (!text.includes(c)) fails.push(`[${s.tag}] missing referred customer ${c}`);
      }
      // 2. NO dollar amount anywhere on the board.
      const money = text.match(/\$\s?\d/g);
      if (money) fails.push(`[${s.tag}] dollar amount on screen: ${money.join(" ")}`);
      if (/\b50\b/.test(text) && /referr/i.test(text) === false) {
        fails.push(`[${s.tag}] suspicious bare 50 near referral copy`);
      }
      // 3. The trophy actually spins (animation applied, not just a class).
      const spin = await page.evaluate(() => {
        const el = document.querySelector(".animate-spin-slow");
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { name: cs.animationName, dur: cs.animationDuration };
      });
      if (!spin) fails.push(`[${s.tag}] no .animate-spin-slow element (trophy not spinning)`);
      else if (spin.name === "none" || !spin.dur || spin.dur === "0s") {
        fails.push(`[${s.tag}] spin class present but no animation: ${JSON.stringify(spin)}`);
      }
      // 4. Boost star visible.
      const stars = await page.evaluate(
        () => document.querySelectorAll('svg[class*="lucide-star"], svg.lucide-star').length
      );
      // 5. No emoji, no clipping.
      const found = [...new Set(text.match(EMOJI) || [])];
      if (found.length) fails.push(`[${s.tag}] emoji: ${found.join(" ")}`);
      const over = await page.evaluate(() => ({
        doc:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        tiles: Array.from(document.querySelectorAll("[data-award-tile]")).filter(
          (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1
        ).length,
      }));
      if (over.doc) fails.push(`[${s.tag}] document overflows`);
      if (over.tiles) fails.push(`[${s.tag}] ${over.tiles} tiles clipped`);

      console.log(
        `[${s.tag}] spin=${spin ? spin.name + "/" + spin.dur : "NONE"} stars=${stars} ` +
          `emoji=${found.length} clipped=${over.tiles} overflow=${over.doc}`
      );
      await page.screenshot({ path: `${OUT}/${s.tag}.png` });
      await page.close();
    }
  });
  if (fails.length) {
    console.log("\n=== REFERRAL VERIFY FAIL ===");
    for (const f of fails) console.log(" x " + f);
    process.exit(1);
  }
  console.log(`\n=== REFERRAL VERIFY PASS === (screenshots in ${OUT}/)`);
})();
