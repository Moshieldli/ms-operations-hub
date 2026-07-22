/**
 * PROBE for the feedback screen-recorder (rev 56): what does screen+mic
 * recording actually weigh at the planned bitrates, and which mimeTypes does
 * Chromium accept? Runs a REAL MediaRecorder over getDisplayMedia+getUserMedia
 * (fake capture source + fake mic via Chromium flags), 10s, extrapolates 60s.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/probe-recorder-size.ts
 */
import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--auto-select-desktop-capture-source=Entire screen",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto("https://ms-operations-hub.vercel.app/finance", {
      waitUntil: "domcontentloaded",
    });
    const result = await page.evaluate(async () => {
      const supported = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ].map((m) => `${m}: ${MediaRecorder.isTypeSupported(m)}`);
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const stream = new MediaStream([...screen.getVideoTracks(), ...mic.getAudioTracks()]);
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
        (m) => MediaRecorder.isTypeSupported(m)
      )!;
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 320_000,
        audioBitsPerSecond: 32_000,
      });
      let bytes = 0;
      rec.ondataavailable = (e) => (bytes += e.data.size);
      rec.start(1000);
      await new Promise((r) => setTimeout(r, 10_000));
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
      stream.getTracks().forEach((t) => t.stop());
      return { supported, mime, bytes10s: bytes, actualMime: rec.mimeType };
    });
    console.log("isTypeSupported:", result.supported.join(" | "));
    console.log(`recorder mime: requested=${result.mime} actual=${result.actualMime}`);
    const b = result.bytes10s;
    console.log(
      `10s recording: ${(b / 1024).toFixed(0)} KB -> 60s extrapolated ~${((b * 6) / 1024 / 1024).toFixed(2)} MB (raw), ~${((b * 6 * 1.37) / 1024 / 1024).toFixed(2)} MB as base64`
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
