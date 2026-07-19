/**
 * End-to-end verify of the feedback system (rev 42): submit feedback WITH an
 * image via the bubble, confirm it lands on /requests with a thumbnail, cycle a
 * status, and build a prompt from it. Asserts on the RENDERED DOM, and drives
 * the bubble by real clicks (dropdown/collapsible children only exist after a
 * click — the repo's curl+regex lesson).
 *
 *   npx tsx scripts/verify-feedback.ts [baseUrl]
 */
import { withBrowser } from "./lib/livecheck";

const BASE = process.argv[2] || "http://localhost:3111";
// A 1x1 red PNG — smallest valid image, proves the upload + storage + serve path.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  const stamp = Date.now();
  const marker = `E2E feedback test ${stamp}`;
  const fails: string[] = [];

  await withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

    // 1. The bubble is present on a dashboard page, absent on /tv/*.
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const bubble = page.locator('button[aria-label="Send feedback"]');
    if ((await bubble.count()) !== 1) fails.push(`bubble count on /sales = ${await bubble.count()}, want 1`);

    await page.goto(`${BASE}/tv/techs`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    if ((await page.locator('button[aria-label="Send feedback"]').count()) !== 0) {
      fails.push("bubble is present on /tv/techs (must be hidden on kiosk screens)");
    }

    // 2. Submit feedback WITH an image, via the real API the bubble calls
    //    (the file picker can't be driven headlessly, so post the same payload).
    const submit = await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
    void submit;
    const postRes = await page.evaluate(
      async ([m, png]) => {
        const r = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: m,
            submitter: "E2E Bot",
            sourceUrl: window.location.origin + "/sales",
            imageDataUri: "data:image/png;base64," + png,
          }),
        });
        return r.json();
      },
      [marker, PNG_1x1] as const
    );
    if (!postRes.ok) fails.push(`submit failed: ${JSON.stringify(postRes)}`);
    const newId = postRes.id as number;

    // 3. The image round-trips as a real binary.
    const imgRes = await page.evaluate(async (id) => {
      const r = await fetch(`/api/feedback/${id}/image`);
      return { status: r.status, type: r.headers.get("content-type") };
    }, newId);
    if (imgRes.status !== 200 || !/image\//.test(imgRes.type || "")) {
      fails.push(`image fetch bad: ${JSON.stringify(imgRes)}`);
    }

    // 4. It shows on /requests with its text, submitter, page, and a thumbnail.
    await page.goto(`${BASE}/requests`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes(marker)) fails.push("submitted feedback not visible on /requests");
    if (!text.includes("E2E Bot")) fails.push("submitter name missing on /requests");
    if (!text.includes("/sales")) fails.push("source page missing on /requests");
    const thumb = await page.locator(`img[src="/api/feedback/${newId}/image"]`);
    if ((await thumb.count()) < 1) fails.push("image thumbnail not rendered on /requests");

    // 5. Cycle the NEW ITEM's status pill (New → Selected) and confirm it
    //    persists. Target the item's own pill (title="Click to change status"),
    //    NOT the status-filter pill that also reads "New".
    const pill = page
      .locator('button[title="Click to change status"]', { hasText: "New" })
      .first();
    if ((await pill.count()) >= 1) {
      await pill.click();
      await page.waitForTimeout(600);
    } else {
      fails.push("no item status pill found to cycle");
    }
    const persisted = await page.evaluate(async (id) => {
      const r = await fetch(`/api/feedback?status=selected`);
      const j = await r.json();
      return (j.items || []).some((it: { id: number }) => it.id === id);
    }, newId);
    if (!persisted) fails.push("status change did not persist to Selected");

    // 6. Build a prompt from the new item; assert it contains the text + page + ritual.
    const built = await page.evaluate(async (id) => {
      const r = await fetch("/api/feedback/build-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      return r.json();
    }, newId);
    if (!built.ok) fails.push(`build-prompt failed: ${JSON.stringify(built)}`);
    else {
      const p = String(built.prompt || "");
      for (const needle of [marker, "/sales", "E2E Bot", "shipping ritual", `feedback #${newId}`]) {
        if (!p.includes(needle)) fails.push(`prompt missing: ${JSON.stringify(needle)}`);
      }
      console.log("--- built prompt (first 400 chars) ---");
      console.log(p.slice(0, 400));
    }

    await page.screenshot({ path: "scratch-feedback-requests.png" });
    await page.close();
  });

  if (fails.length) {
    console.log("\n=== FEEDBACK VERIFY FAIL ===");
    for (const f of fails) console.log(" x " + f);
    process.exit(1);
  }
  console.log("\n=== FEEDBACK VERIFY PASS ===");
})();
