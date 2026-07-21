# Wellness Calls Campaign — build report (2026-07-21, rev 51)

## What shipped

A self-refilling PhoneBurner queue of **active customers with 2+ completed mosquito sprays this
season**. One dial attempt of ANY kind (connected, VM, No Answer) removes the customer from the
queue for the rest of the season and moves them to a "Called" folder; new qualifiers flow in
automatically as they hit their 2nd spray. Full detail in REFERENCE **§5.21**.

- **Folders** — `Wellness — Queue 2026` = **66255089**, `Wellness — Called 2026` = **66255090**
  (probed via `GET /folders`, `scripts/probe-wellness-folders.ts`). Both wired into `folders.ts`
  as `WELLNESS_QUEUE_FOLDER` / `WELLNESS_CALLED_FOLDER` and added to **`EXEMPT_FOLDERS`** — never
  policed, so the hourly conversion sweep leaves them alone.
- **Spray counter** — new `mosquito_service_status.sprays_this_season`, aggregated inside the
  06:00 refresh by the new exported `updateSprayCounts()` from `respray_jobs` (see judgment call
  below). Year-rollover safe: absent-from-respray_jobs zeroes only after a SUCCESSFUL
  completed-jobs refresh.
- **`wellness_calls` table** — PK `(pocomos_id, season)`, the one-call-per-season re-entry guard.
  `pocomos_id` is the INTERNAL url_id.
- **Webhook fall-out** — a call on a Queue-folder contact (or `Hub Source = wellness`) triggers,
  in order: (1) `wellness_calls` insert FIRST (`ON CONFLICT DO NOTHING` — guard holds even if the
  move fails; re-fires no-op), (2) PB move to Called (form-urlencoded PUT) + `phoneburner_contacts`
  re-point, (3) Pocomos note written DIRECTLY to the internal id (resolve step skipped), subject
  `Wellness Call`. All inside the existing `waitUntil`; every disposition counts.
- **Feeder** — `src/lib/sync/wellnessFeed.ts` + `GET /api/cron/wellness-feed` (07:00 daily,
  after the 06:00 refresh). Eligibility: Active + CY tag (getDataset roster) ∧ sprays ≥ 2 ∧ no
  `wellness_calls` row this season ∧ phone not already in the Queue ∧ not paused-balance
  (`EXCLUDE_PAUSED_BALANCE = true`, one-line flip). Push carries Customer ID (internal), Pocomos
  Profile URL, `Hub Source = wellness`, CSR-opener notes (sprays · last spray · sign-up), street
  address + zip. Reconciliation: a Queue contact that already has a `wellness_calls` row is moved
  to Called instead of skipped silently. `?dryRun=1` supported.
- **Notes-refresh Phase B** now also covers the wellness Queue folder (Called excluded on purpose).
- **Scripts** — `probe-wellness-folders.ts`, `run-wellness-counts.ts` (counter fill + spot-check),
  `run-wellness-feed.ts` (dry by default, `--live` to push).

## Numbers

| Metric | Value |
|---|---|
| Active roster (status Active + CY tag) | 1,165 |
| Eligible rows with a spray count | 1,152 |
| At 2+ sprays this season | **1,137** |
| Feeder would-push (dry run) | **1,114** |
| Excluded: paused-balance | 9 |
| Excluded: no usable phone | 2 |
| Excluded: shared-phone duplicates (collapsed) | 12 |
| Spray-count distribution | 0×2 · 1×15 · 2×52 · 3×68 · 4×134 · **5×761** · 6×87 · 7×18 · 8–12×17 |
| Conversion-sweep dry run | 4,275 scanned · 9 policed folders walked · wellness folders walked: **NONE** · 0 would-moves |

Reconciliation: 1,137 (2+) − 9 (paused) − 2 (no phone) − 12 (phone dupes) = 1,114 ✓.
(0 alreadyCalled / 0 notActive — expected on day one with an empty queue.)

## Judgment calls

1. **Spray counter sourced from `respray_jobs`, NOT the per-customer service-history scrape the
   spec prescribed.** The spec's premise ("no bulk source exposes a per-season service COUNT") was
   out of date: `respray_jobs` (§5.12) reloads daily from ONE completed-jobs-report POST covering
   all of `CURRENT_YEAR`, mosquito-family only, keyed by internal customer id. It is cheaper
   (0 extra Pocomos calls vs ~1,100 scrapes/day) and **more correct** — it covers add-on customers
   whose default rendered contract isn't mosquito, exactly the population the scrape can never
   read (the spec's "leave the count at its prior value" would have frozen them at 0 forever).
   Validated: **5/5 random spot-checks matched an independent service-history scrape exactly.**
2. **Cron shipped dry-run-gated.** The spec's rollout makes the live fill wait for your go, but a
   deployed 07:00 cron would have auto-filled the queue tomorrow morning. The vercel.json entry
   points at `?dryRun=1` (daily logged counts, zero writes); going live = drop the param.
3. **§5.8 was taken** (return rate) — the campaign section is **§5.21**.
4. **Address push is street + zip only.** The completed-jobs Address cell is street-only (probed:
   "68 Meadow Rd" etc.); no bulk source carries city/state, so they're left blank rather than
   guessed. Street comes from a new `respray_jobs.address` column (parsed from the report the
   refresh already pulls — zero extra requests).
5. **Note `subject: "Wellness Call"`** is passed inside the note-create payload; the live note
   flow has never used a subject field, so Pocomos may silently ignore it (harmless — the summary
   itself opens with the standard loop-guarded call header). Verify on the first real dial.
6. **Wellness note writes on EVERY webhook**, including a re-fire after the guard exists — full
   call history on the account is the documented §5.4 behavior; the guard only stops re-queueing.
7. **`alreadyQueued = 12` on an empty queue** = 12 candidates sharing a phone with an
   earlier-selected candidate (couples/households) — collapsed to one queue entry per phone by
   design.

## Verification

- `npx tsc --noEmit` and `npm run build` clean.
- **Checkpoint 1** — conversion-sweep dry run AFTER the folder wiring: walks exactly the 9 policed
  folders; wellness folders appear nowhere; 0 would-moves.
- **Checkpoint 2** — counter filled (1,152 rows) and spot-checked: 5 random 2+ customers
  cross-validated against the live Pocomos service-history page — **5/5 exact matches**
  (ids 1250858, 1164131, 1163862, 1163620, 1163672).
- **Checkpoint 3** — schema + webhook deployed (safe with an empty queue; wellness branch is
  unreachable until contacts carry the queue folder / Hub Source field).
- **Checkpoint 4** — feeder dry run: would-push 1,114, 0 errors, list persisted here + printable
  any time via `scripts/run-wellness-feed.ts` (dry by default).
- **Live** — deployment verified fresh after push; `verify-live.ts` smoke test passed;
  `/api/cron/wellness-feed?dryRun=1` responds on production.
- **Not yet verified (needs a real dial):** the webhook wellness branch end-to-end. Suggested
  smoke test on go-live day: one controlled call → check the `wellness_calls` row, the
  Queue→Called move, and the Pocomos "Wellness Call" note.

## Addendum (same day, review follow-up)

Ops review with the first-20 list: **Brittany McAuliffe (1164546) excluded as staff** — new
`EXCLUDED_POCOMOS_IDS` constant in `wellnessFeed.ts` (+ `staffSkipped` counter). Would-push
**1,114 → 1,113**; 1,096 of those are bi-weekly, 17 weekly. The driver script now also prints a
random 20-row bi-weekly sample (the sprays-desc top-20 is all weekly customers). Flagged to ops:
Rivka Leyton (1163970) is also in the list (staff-as-customer, like Ohavia who was deliberately
kept) — awaiting a keep/exclude call before the live fill.

## Rollout — remaining steps (on your go)

1. Rivka eyeballs the would-push list (`run-wellness-feed.ts`, dry).
2. `run-wellness-feed.ts --live` for the initial fill (or flip the cron and wait for 07:00).
3. Flip the vercel.json cron path `/api/cron/wellness-feed?dryRun=1` → bare path; push.
4. One more conversion-sweep dry-run check; controlled first-dial smoke test; Rena starts dialing.
