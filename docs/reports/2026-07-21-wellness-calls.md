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

## GO-LIVE (same day — Rivka approved the list; Rivka Leyton deliberately kept)

- **Initial fill:** `run-wellness-feed.ts --live` → **pushed 1,113 / 1,113, 0 errors**, 461s.
  Exclusions as reviewed: 9 paused-balance · 1 staff (Brittany) · 2 no-phone · 12 phone dupes.
- **PB verification:** folder walk found 1,112 + the 1 "missing" contact verified IN the Queue by
  direct GET (Anna Riesenberg, pb 1295574535, category 66255089) — all 1,113 exist; the folder
  list index lagged by one at check time. Called folder: 0, as expected.
- **Cron flipped live:** vercel.json path `?dryRun=1` → bare `/api/cron/wellness-feed`; the 07:00
  daily auto-refill now pushes for real.
- **Final sweep check:** dry run AFTER the fill — 4,249 scanned across exactly the 9 policed
  folders, wellness folders never walked, **0 would-moves**, 0 errors.
- Nothing was dialed or triggered beyond adding contacts; first call is the CSR's manual test.

## Post-go-live: first-dial test FAILED → root cause found + fixed (same day)

Two CSR test dials (Ohavia 1163370 ~8:51 ET, Leon 1163371 ~9:10 ET) logged dispositions in PB but
produced NO fall-out. Diagnosis:

1. Both `api_calldone` events ARRIVED (webhook_log 294/295) — error `no Customer ID`.
2. **Root cause: PB's real payload carries `typed_custom_fields`, `custom_fields`, and `folder`
   at the TOP LEVEL — `contact.typed_custom_fields` does not exist on the wire.** The parser read
   only `contact.*` → Customer ID always empty → wellness branch never gated in. NOT an
   old-contact edge case: **all 1,113 would have failed identically.** Same bug explains rev 20's
   "pocomos_id NULL on all 293 webhook rows" — the webhook→Pocomos note write has been silently
   dead since launch.
3. The contacts themselves were fine: PB had MERGED the fill's creates into pre-existing Apr-15
   contacts by phone (returning the old ids — which the fill correctly stored), and the merged
   contacts carry category=Queue + all three custom fields (REST-verified).

**Fix (182fc43):** extraction reads top-level `typed_custom_fields`/`custom_fields` (contact-level
kept as fallback); wellness detection uses the payload's top-level `folder.id` (+ category +
Hub Source + our own cache row's folder); NEW DB bridge `pb_contact_id → phoneburner_contacts →
pocomos_id` resolves field-less payloads (internal id → direct note write, no resolve step) — the
webhook now survives payload-shape drift.

**Verification:** replayed both REAL stored payloads through the fixed parser — both extract
`pocomosId` + `wellness=true`. Then replayed Leon's payload (log 295) through the PRODUCTION
webhook: `wellness_calls` row created (Left Message, CSR captured) · contact moved to Called
(66255090, REST-verified) · Pocomos note confirmed in the all-notes report ("📞 PhoneBurner Call —
Left Message · 36s · CSR Ohavia Feldman" + recording link) · webhook_log 296 `note_written=true`,
no error. Queue now 1,112 / Called 1.

**Re-test:** Ohavia's call was deliberately NOT replayed — her contact (pb 1275424935) remains in
the Queue so the CSR can re-dial HER as the fresh end-to-end test of the live PB→webhook trigger.
The other 1,111 contacts are expected to work: the bug was parser-level (identical for everyone),
contact data is verified good, and detection now has three independent paths.

**Re-test PASSED (same morning):** webhook_log 297 (Ohavia re-dial 10:01 ET) + 298 (Rivka 10:14 ET)
both processed clean off live dials — guard rows, Queue→Called moves, notes written. Live
PB→webhook trigger proven end-to-end. Team clear to dial.

## Note-format redesign (rev 52, same day — ops requirements + 2 bugs)

**New format** (`buildPocomosSummary`): `{Campaign} call — {disposition}` (campaign from the dialed
folder via `campaignForFolder`: Wellness / Lead / Win-back / PhoneBurner) · optional `Email sent:
{name}` (best-effort `extractEmailSent` over `call_notes[]` + `events.last_event`; no real email
payload captured yet — line skipped when undetectable) · `{CSR} · {duration}s` · optional
`Notes: {text}` (auto-disposition text still filtered; `Notes: (none)` gone).

**Bug 1 — loop guard:** verified live: Pocomos stores 📞 as literal `?` (`? PhoneBurner Call — …`),
so the old `startsWith("📞 …")` read-back dedup NEVER matched — silently broken since launch. New
shared emoji-free `PB_NOTE_GUARD` regex matches the new first line AND all stored legacy forms
(`📞`/`?`/bare, em/en/hyphen dashes), wired into BOTH sides (writer + `notes.ts::classifySource`
→ leadSync + notesRefresh). 12/12 guard-matrix cases pass, including real stored text.

**Bug 2 — recording URL:** verified the stored URLs from all 4 real calls — short private form AND
the intact 245-char public form ALL 404 (public redirects to S3, no object; PB fills the fields
even on unconnected VM drops). Dropped the recording line from the note entirely (recording lives
in PB call history when it exists).

**Backwards compat:** historical `webhook_log.raw_payload` rows replay through `parseWebhook` into
the new format — backfill-ready with no shim (BACKLOG item added).

**Verified:** new note rendered from Rivka's REAL stored payload (log 298):
`Wellness call — Left Message` ⏎ `Ohavia Feldman · 14s`. Live replay of that payload against the
production webhook wrote the new-format note to her record (all-notes report readback confirms),
duplicate-guard no-op on wellness_calls as designed.

## Email-sent line + replay gate + cleanup (rev 53, same day — ops correction)

Ops corrected rev 52's "no email example" caveat: one-touch emails DID go out on the test calls.
Re-search of the FULL payloads found the marker **in the same `api_calldone` payload**, as a
contact-notes entry — `-- 07/21/2026 @ 8:52 AM EDT by Ohavia Feldman -- Email sent: Are we living
up to your expectations?` — I'd previously missed it (only read the first 2 note lines +
`events`/`call_notes`). Two more finds: (1) the modern header inserts `by {agent}`, which the old
`ENTRY_HEADER` regex didn't consume — entry parsing was silently dead on every modern payload
(fixed); (2) payload `start_time`/`end_time` are CT while note headers are ET, so the timestamp
guard compares note headers to each other: only "Email sent" entries in the newest same-day
cluster (±3 min) count. **Proven on all 4 real payloads** — 3 sends extracted with the exact
subject; Ohavia's 10:01 re-dial (payload carries only her stale 8:52 email entry) correctly null.
No REST activity endpoint needed.

**Replay gate (6b):** webhook hard-skips the note write when a `webhook_log` row with the same PB
`call_id` already has `note_written=TRUE` (expression index added). Live-proven: replay #1 of
log 294 wrote Ohavia's note; replay #2 logged `duplicate call_id 3046404595 — note already
written (replay guard)` and wrote nothing. This is also the historical-backfill dedupe.

**Cleanup (6a):** Pocomos DOES have a delete path — `POST /customer/{id}/note/{noteId}/delete`
(`data-method=post` UI action; 405 on GET, as the landmine rule predicts for actions). With ops
authorization, deleted the three old-format test notes (Leon 5375041, Ohavia 5375076, Rivka
5375089) after verifying each note's customer mapping. Rivka's duplicate is resolved.

**Final state on record (all-notes readback):** exactly two notes today —
Rivka 5375168: `Wellness call — Left Message ⏎ Ohavia Feldman · 14s`; Ohavia 5375192:
`Wellness call — Left Message ⏎ Email sent: Are we living up to your expectations? ⏎
Ohavia Feldman · 17s`. BACKLOG: email-capture item closed; added backlog-only "Email sent ·
opened" enhancement (PB Activity tracks opens; arrives post-call, needs a later read — unprobed).
