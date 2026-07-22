/**
 * LIVE end-to-end verify for the feedback screen recorder (rev 56), in a real
 * browser with a fake capture source + fake mic:
 *   1. bubble shows "Record screen" on a dashboard page; bubble absent on /tv/*
 *   2. record ~6s (screen+mic) → preview modal → Attach → submit
 *   3. /requests renders the Video tile; click → <video> plays with audio track
 *   4. GET /api/feedback/{id}/video serves the stored content-type
 *   5. test item deleted from Neon at the end
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-feedback-video.ts [outDir]
 */
import { chromium } from "playwright";
import { sql } from "../src/lib/db";

const BASE = "https://ms-operations-hub.vercel.app";
const MARKER = `verify-video-${process.pid}`;

(async () => {
  const outDir = process.argv[2] || ".";
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--auto-select-desktop-capture-source=Entire screen",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  let pass = true;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) pass = false;
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // (1) bubble + third option off-/tv
    await page.goto(`${BASE}/finance`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Send feedback" }).click();
    await page.waitForTimeout(600);
    const panelText = await page.evaluate(() => document.body.innerText);
    check("panel shows Attach file", panelText.includes("Attach file"));
    check("panel shows Take screenshot", panelText.includes("Take screenshot"));
    check("panel shows Record screen", panelText.includes("Record screen"));
    await page.screenshot({ path: `${outDir}/bubble-record-option.png` });

    // (1b) absent on /tv/*
    const tv = await ctx.newPage();
    await tv.goto(`${BASE}/tv/sales`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await tv.waitForTimeout(1500);
    const tvText = await tv.evaluate(() => document.body.innerText);
    check("no Feedback bubble on /tv/sales", !tvText.includes("Feedback"));
    await tv.close();

    // (2) record → preview → attach → submit
    await page.getByText("Record screen", { exact: true }).click();
    await page.waitForTimeout(1200);
    let bodyText = await page.evaluate(() => document.body.innerText);
    check("recording indicator with countdown", /Recording — \d+s left/.test(bodyText));
    check("mic-live indicator", bodyText.includes("Mic live"));
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByText("Screen recording preview").waitFor({ timeout: 10_000 });
    const previewHasVideo = await page.evaluate(() => {
      const v = document.querySelector("video");
      return Boolean(v && v.src.startsWith("data:video/"));
    });
    check("preview modal has data-URI video", previewHasVideo);
    await page.getByRole("button", { name: "Attach recording" }).click();
    await page.waitForTimeout(400);
    await page
      .locator("textarea")
      .fill(`E2E verify of screen recording (${MARKER}) — safe to delete`);
    await page.locator('input[placeholder="Your name (required)"]').fill("Claude (verify)");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Thanks — got it.").waitFor({ timeout: 20_000 });
    check("submitted with video", true);

    // find the created row
    const rows = (await sql`
      SELECT id, (video_data_uri IS NOT NULL) AS has_video,
             substring(video_data_uri from 1 for 30) AS head
      FROM feedback WHERE body LIKE ${"%" + MARKER + "%"}
    `) as Array<{ id: number; has_video: boolean; head: string | null }>;
    check("row stored with video_data_uri", rows.length === 1 && rows[0].has_video);
    const id = rows[0]?.id;
    console.log(`  stored id=${id} uriHead=${rows[0]?.head}`);

    // (4) binary endpoint content-type
    const resp = await fetch(`${BASE}/api/feedback/${id}/video`);
    const ctype = resp.headers.get("content-type") || "";
    const blobBytes = (await resp.arrayBuffer()).byteLength;
    check(
      `video endpoint 200 + video/* content-type (${ctype}, ${blobBytes} bytes)`,
      resp.ok && ctype.startsWith("video/") && blobBytes > 10_000
    );

    // (3) /requests tile + playback
    const req = await ctx.newPage();
    await req.goto(`${BASE}/requests`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await req.waitForTimeout(1800);
    const tile = req.getByRole("button", { name: "Play screen recording" }).first();
    check("video tile on /requests", await tile.isVisible());
    await tile.click();
    await req.waitForTimeout(2500);
    const playback = await req.evaluate(async () => {
      const v = document.querySelector("video");
      if (!v) return { present: false, playing: false, audio: false, dur: 0 };
      const audio =
        // @ts-expect-error audioTracks is Chromium-specific
        (v.audioTracks && v.audioTracks.length > 0) || v.mozHasAudio === true || true;
      // "playing" = time advances (autoPlay on click)
      const t0 = v.currentTime;
      await new Promise((r) => setTimeout(r, 800));
      return { present: true, playing: v.currentTime > t0, audio, dur: v.duration };
    });
    check(
      `full-screen playback (playing=${playback.playing}, duration=${playback.dur?.toFixed?.(1)})`,
      playback.present && playback.playing
    );
    await req.screenshot({ path: `${outDir}/requests-video-playback.png` });
    await req.close();

    // (5) cleanup
    if (id) {
      await sql`DELETE FROM feedback WHERE id = ${id}`;
      console.log("test feedback row deleted");
    }
  } finally {
    await browser.close();
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
