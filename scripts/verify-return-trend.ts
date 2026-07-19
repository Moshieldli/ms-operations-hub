/**
 * Verify the 5-season return-rate trend on /sales (rev 33).
 *
 * The card is taxonomy-driven and the page paints snapshot-first, so this waits
 * for the Return rate card to actually populate before asserting — a short
 * fixed settle reads the pre-taxonomy skeleton and fails for the wrong reason.
 */
import { withBrowser } from "./lib/livecheck";

const BASE = process.argv[2] || "http://localhost:3111";
const PAIRS = ["2021 → 2022", "2022 → 2023", "2023 → 2024", "2024 → 2025", "2025 → 2026"];

(async () => {
  const fails: string[] = [];
  await withBrowser(async (b) => {
    const page = await b.newPage();
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Wait for the taxonomy to land: the oldest pair only exists once it has.
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("2021"),
        undefined,
        { timeout: 90_000 }
      );
    } catch {
      fails.push("timed out waiting for the return-rate card to populate");
    }
    await page.waitForTimeout(1500);

    const body = await page.evaluate(() => document.body.innerText);
    for (const p of PAIRS) {
      if (!body.includes(p)) fails.push(`MISSING pair: ${p}`);
    }
    if (!body.includes("spray-only")) fails.push("MISSING the spray-only seam marker");
    if (!/trend/i.test(body)) fails.push("MISSING the trend header");

    // The sparkline must render one point per reliable pair.
    const dots = await page.evaluate(
      () => document.querySelectorAll("svg[role='img'] circle").length
    );
    if (dots !== PAIRS.length) fails.push(`sparkline has ${dots} points, expected ${PAIRS.length}`);

    const rates = (body.match(/\d{2}\.\d%/g) || []).slice(0, 12);
    console.log("sparkline points:", dots);
    console.log("rates seen:", rates.join(" "));

    await page.close();
  });

  if (fails.length) {
    console.log("\n=== RETURN TREND VERIFY FAIL ===");
    for (const f of fails) console.log(" ✗ " + f);
    process.exit(1);
  }
  console.log("\n=== RETURN TREND VERIFY PASS ===");
})();
