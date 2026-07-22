# 2026-07-22 — FEEDBACK-RECORDING + CASH-REGISTER (revs 55 + 56)

Two features, one run, **two deploys** (per the mid-run re-order: Task B first so it was live in
the morning, Task A second). Combined report.

---

## What shipped

### Task B first — CASH-REGISTER moment on /finance + Collections Mode (rev 55)

Display-only celebration when a paused-balance customer's open balance is collected (staff run the
card in Pocomos; the hub only notices >0 → $0 and celebrates). Pieces:

- **`balance_clearances`** table (initSchema) with a per-`(pocomos_id, UTC-day)` unique index —
  the ring-once guard. Every writer inserts `ON CONFLICT DO NOTHING`; only a returned row rings,
  so poll + visibilitychange + nightly refresh can all see the same clear and exactly one logs it.
- **Refresh-path detection** inside `refreshMosquitoStatus` (so BOTH the 06:00 cron and "Refresh
  now" detect): prior per-customer balances snapshotted BEFORE the prune/upsert, diffed against the
  fresh unpaid pull. Guards: full clears only (partials never celebrate), still-eligible customers
  only (a cancelled row vanishing is not a payment), empty-report guard (0 parsed customers = a
  broken shell, skip). Failure never fails the refresh. New `RefreshMeta.balanceClearances`.
- **Collections Mode** (the near-real-time loop for the sit-on-/finance-and-run-cards workflow):
  "Start collections session" in the paused-card header → re-check on `visibilitychange` (tabbing
  back from Pocomos) + 20s fallback poll → `POST /api/finance/collections-check` (fresh
  Unpaid-Invoices pull diffed against the paused roster — NOT a full mosquito refresh; 10s
  soft-lock coalesces concurrent tabs). Fresh clears: chime + green flying "+$412 — Jane D." +
  the row flashes green and slides out + session tally ("This session: $X · N customers").
  Auto-stops after 10 quiet minutes; per-tab persistence (sessionStorage). The start click unlocks
  the AudioContext, so autoplay never blocks mid-session. Cleared rows get
  `status='cleared_balance'` (rendered nowhere) until the next full refresh recomputes them.
- **Passive path** (for whoever didn't run the session, e.g. next morning): on load, clearances
  newer than a per-browser localStorage marker → one chime + staggered flyers + "Collected $X
  since you last looked (N customers)", marker advances to `serverNow`. First visit initializes the
  marker silently. Autoplay blocked → visual runs anyway + a "Replay sound" speaker affordance.
  Mute toggle (lucide Volume2/VolumeX) persisted. `prefers-reduced-motion` → fade-only, no motion.
- **Sound**: WebAudio-synthesized two-bell "cha-ching" (B5→E6 triangle + sine shimmer) — no
  copyrighted asset. Never on `/tv/*` (self-guarded on pathname like the feedback bubble).

### Task A second — Feedback bubble "Record screen" with mic narration (rev 56)

Third capture option next to **Attach file** and **Take screenshot** — both untouched (html2canvas
+ the markup step exactly as they were; the screen-share picker is inherent to recording and stays).

- `getDisplayMedia` (screen) + `getUserMedia` mic (`echoCancellation` + `noiseSuppression`) merged
  into one `MediaRecorder`. Mic denied/failed → **silent recording with a visible note, never
  aborts**. Mic track from getUserMedia, not getDisplayMedia audio.
- Feature-detected (no getDisplayMedia / MediaRecorder → button never renders).
- mimeType via `isTypeSupported`: vp9,opus → vp8,opus → webm → mp4. Actual mime stored + served.
- Max **60s** with countdown, Stop button, red pulsing mic-hot indicator; panel hidden while
  recording; browser-chrome "stop sharing" lands on the same clean stop; **all tracks (screen +
  mic) stopped** on stop/discard/cancel/unmount.
- **`MAX_VIDEO_BYTES = 3 MB`** next to `MAX_IMAGE_BYTES` (ceiling = ~4.5 MB Vercel body limit,
  base64 ×1.37 — not the 60s). 350kbps video + 32kbps opus; 1s chunks; auto-stop at 95% of cap
  with a "size limit reached" note.
- Stop → **preview modal WITH audio** → Attach recording / Discard & re-record / Cancel; attached
  clip shows as a compact playable element with Remove.
- Storage/API mirror the image pattern: nullable `feedback.video_data_uri` (validated or silently
  dropped; image, video, both, or neither), `hasVideo` on list rows (never the blob),
  `GET /api/feedback/{id}/video` serves the real binary with the stored content-type. `/requests`
  rows get a Video tile (lucide icon) → existing full-screen viewer with `<video controls
  autoPlay>` — click is the gesture, audio plays. Rate limit unchanged.
- Drive-by: fixed the pre-existing "Updated Updated 4h 40m ago" double-word on /finance
  (the page wrapped `RefreshedAt`, which already prints "Updated").

## Numbers

- **Unpaid-Invoices pull (probe, live):** 2.4–3.4s per pull (63 customers / 83 invoices /
  $22,839.49). **Two back-to-back pulls agreed exactly** — no transient invoice omission observed.
  20s poll + visibilitychange is comfortable; the deployed check ran in 2.7s.
- **Paused roster at ship time:** 10 accounts / $2,888.84. 0 would-clear, 0 partial drops — so the
  live celebration was verified with a **seeded fake clearance** (deleted after; see Verification).
- **Recording weight (probe, real Chromium MediaRecorder):** vp9+opus honored; 10s = 212 KB →
  **~1.24 MB raw / ~1.70 MB base64 per 60s** on the fake source; worst case at full bitrate
  ≈2.9 MB raw / ≈3.9 MB base64 — inside the 3 MB cap / 4.5 MB wire limit. Quality at 350kbps is
  fine for screen content — **no chunked upload needed** (not built, not required).
- **E2E recording artifact:** 6s clip = 141,939 bytes stored, served as `video/webm`.

## Judgment calls

1. **Detection source = (a) balance-level diff** (`mosquito_service_status.open_balance` vs fresh
   unpaid pull), not (b) invoice-level diffing: a "clear" is balance-level by definition;
   invoice-level state adds machinery without adding reliability. The probe's exact two-pull
   agreement supports the report being stable within a run.
2. **Ring-once = per-(customer, UTC-day) unique index** + `ON CONFLICT DO NOTHING` (+ the
   collections path zeroing the stored row). A same-day re-clear can't double-ring; a cross-day
   duplicate would need the balance to go >0 → 0 again across the boundary, which is a real event.
3. **Mass-clear guard deliberately NOT added** beyond the empty-report guard: the paused roster is
   ~10 rows, and a busy collections morning legitimately clears half of it — a %-based guard would
   suppress real celebrations. The empty-report guard covers the actual failure mode (broken shell).
4. **Known residual false-positive:** an invoice voided/credited in Pocomos (not paid) also reads
   as >0 → $0 and would ring. Rare, accepted, documented in §5.14b.
5. **First visit initializes the passive marker silently** — celebrating a month of history on a
   browser's first look would be noise, not news.
6. **Cleared rows get `status='cleared_balance'`** (a bucket no roster renders) instead of guessing
   overdue/current — the next full refresh recomputes the truth. Interim invisibility for minutes
   to hours is preferable to a wrong bucket.
7. **Two rev notes (55 + 56), not one rev 55:** the spec predates the re-order into two
   commits/deploys; one rev per deploy keeps the header history honest ("never end a session with
   stale docs" — each commit carries its own rev).
8. **Session tally counts FRESH rings only** (clears this browser rang), matching ring-once; a
   clear the nightly refresh already logged still animates out of the roster but doesn't add to
   the tally.
9. **Landmine found live (Task A):** `recorder.mimeType` returns `video/webm;codecs=vp9,opus` —
   the comma inside `codecs=` breaks data-URI parsing, so the first E2E stored NULL video. Fixed by
   stripping parameters client-side (bare container mime; `<video>` sniffs codecs) + parameter-
   tolerant server regexes. Documented in §5.18.
10. **Screenshots committed** under `docs/reports/2026-07-22-img/` — the ask was explicit and the
    scratchpad is ephemeral.

## Flagged as unmeasured

- **Pocomos card-processed → invoice-marked-paid latency** is unknown. If Pocomos lags minutes
  internally, the visibilitychange check catches the clear a cycle (or a poll) later. The first
  real collections session validates; nothing to tune until then (poll is already 20s).

## Verification (all on production, real browser — Playwright)

**Task B (`scripts/verify-clearance-lib.ts` + `scripts/verify-finance-clearances.ts`), all PASS:**
- Lib: schema created; live collections-check ok in 2.7s (0 clears — matches reality); dedupe
  proven (second same-day insert = 0 rows); listing returns the row; test rows deleted.
- Live UI (fake $412 clearance seeded — **no real payment existed at ship time** — marker set 1h
  back, then deleted): "Collected $412.00 since you last looked (1 customer)" line ✓, flying
  "+$412.00 — Verify P." rendered ✓, "Start collections session" ✓, session-live state + "This
  session: $0.00 · 0 customers" tally ✓, paused card + roster intact ✓.
  Screenshot: `2026-07-22-img/finance-flyer.png`.

**Task A (`scripts/verify-feedback-video.ts`), 13/13 PASS:**
- Bubble on /finance shows Attach file + Take screenshot + **Record screen** ✓
  (screenshot `2026-07-22-img/bubble-record-option.png`); bubble absent on `/tv/sales` ✓.
- Real recording (Chromium fake screen+mic): countdown indicator ✓, "Mic live" ✓, Stop → preview
  modal with data-URI video ✓, Attach → submit ✓.
- Row stored with `video_data_uri` (`data:video/webm;base64,…`) ✓; `GET /api/feedback/{id}/video`
  → 200, `video/webm`, 141,939 bytes ✓.
- `/requests` renders the Video tile ✓; click → full-screen `<video>` actually playing
  (currentTime advancing) ✓ (screenshot `2026-07-22-img/requests-video-playback.png`).
  (Streamed-webm quirk: `duration` reads `Infinity` until buffered — cosmetic.)
- Test feedback row deleted after ✓ (plus one orphan from the failed first pass, also deleted).

**Deploys:** two manual `npx vercel --prod` deploys, both Ready (git auto-deploy also fired on the
rev-55 push). `npx tsc --noEmit` + `npm run build` clean before each.

---

## Follow-up (same day, rev 57) — installments correctness probe: NO code change needed

Ops correction: the paused list = customers with OVERDUE payments; installment customers may still
owe future installments after a successful collection — does the zero-test hold?

**Probe (read-only, `scripts/probe-unpaid-duedates.ts` + `probe-unpaid-duedates2.ts`):** parsed the
Unpaid-Invoices report per-invoice. The Dates cell carries `Due MM/DD/YY`; each row carries an
explicit `Status:` text. Findings, 2026-07-22:

- **All 83 invoices are due as of today** — due-date range 2025-04-01 → exactly today, statuses
  only "Past due" (46) / "Due" (37). **Zero future-due invoices**, even though our request's date
  window extends through Dec 31 next year — the form's aging buckets (lessThan30…moreThan90) are
  *past-due ages*, so a not-yet-due invoice has no bucket and the server never returns it.
- A live installment customer proves it: "Installment 1 of 4 – 2025 Auto-Renew" (due 04/01/25)
  appears only because it is past due; installments 2–4 are absent until they come due.
- Paused-roster cross-check: all 10 stored balances equal their past-due-only sum; $0 future-due.

**Conclusion — the past-due-only branch:** `open_balance` already means **overdue balance** by
construction, so the >0 → $0 clearance test is correct for installment customers (paying the
overdue installment rings the register even though future installments remain), and no roster
membership changes. No code change; REFERENCE §5.14b documents the finding (rev 57). One nuance
documented: an installment customer legitimately re-enters the paused roster when the next
installment goes unpaid, and can ring again on a later UTC day — that's a genuine new collection,
not a duplicate.
