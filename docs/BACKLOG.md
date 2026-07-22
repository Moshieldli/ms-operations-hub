# Backlog — MS Operations Hub

## Ready to build (unblocked)
- [ ] **Lead-note write path is DEAD — 39 backfill rows waiting (rev 54).** `/jwt/{office}/lead/{id}/note`
      404s on every real lead, so lead calls get NO Pocomos note (live webhook + backfill alike).
      39 lead-record rows remain `note_written=FALSE` (9 tracked leads + 30 frozen-lead-id contacts)
      and will backfill automatically via `scripts/backfill-webhook-notes.ts` once a working path
      exists. Finding one means probing lead-note creation endpoints — MUTATION territory, probe
      with care (the lead-information page's note widget form is the likely candidate).
- [ ] **"Email sent · opened" enhancement (backlog-only, do not build yet):** PB's contact Activity
      stream tracks one-touch OPENS ("Rivka Leyton just opened a one-touch message") as well as
      sends. The open happens after the call, so it can't ride the `api_calldone` payload — it
      would need a later notes/activity read (does the open land in `contact.notes`? unprobed) or
      a REST activity endpoint (unprobed). Would let CSR notes read "Email sent: … · opened" so the
      team knows who actually read the follow-up. (The SEND side shipped in rev 53 —
      `extractEmailSent`, proven live.)
- [ ] Cancelled – This Year (by deactivation date) + cancelled-by-reason — needs the per-customer
      deactivation scrape job (date+reason are scrape-only; sales_status scrapeable from
      service-information). See REFERENCE §9 #6.
- [ ] Assigned-only "Next scheduled" + 48h color rescue: per-customer scheduled-services scrape,
      Route Assigned == "Assigned" (exact match), wire into rowToneClass() hook. See REFERENCE §9 #5.
- [ ] Top converting lead sources — rank marketing source/type by conversion (which sources turn
      into customers, not just volume). Note: lead-side marketing_type is ~93% blank, so source the
      marketing type from the converted customer's record; join via the converted leads from the
      Advanced Search two-step feed (REFERENCE §9 Resolved #11). Self-probe the customer-side
      marketing field first.
- [ ] Marketing source breakdown: Long Island vs Westchester

## Needs a human decision
- [x] ~~**Wellness live fill — GO/NO-GO (rev 51, 2026-07-21).**~~ **GONE LIVE 2026-07-21** — Rivka
      approved the list (Rivka Leyton kept, like Ohavia; Brittany stays excluded). Initial fill ran
      via `run-wellness-feed.ts --live`; cron flipped to the bare path (07:00 daily, for real).
      First dial = manual CSR test the next day. Fill numbers in the 2026-07-21 report. Rivka to eyeball the would-push list (`scripts/run-wellness-feed.ts`, dry by
      default). On go: (1) run the script with `--live` for the initial fill, (2) flip the
      vercel.json cron path from `/api/cron/wellness-feed?dryRun=1` to the bare path (the shipped
      cron is dry-run-gated on purpose), (3) re-run the conversion-sweep dry-run as a final check,
      (4) Rena starts dialing. Suggested first-dial
      smoke test: one controlled call on a known customer → verify the `wellness_calls` row, the
      Queue→Called move, and the Pocomos "Wellness Call" note.
- [ ] **RESPRAY-YOY weather probe (rev 47, 2026-07-20) — rainfall is NOT a monthly driver of resprays
      or cadence; the YoY decline is operational.** Pulled Open-Meteo historical daily rainfall for our
      area (40.597/-73.702), Apr–Oct 2024/2025/2026, vs monthly respray rate (Re-service ÷ apps; 2025
      & 2026 only — 2024 RealGreen has no re-service typing) and monthly cadence (share of
      consecutive-spray gaps >17d; all three years). **Same-month Pearson r: rain vs respray rate
      −0.19 (n=11), rain vs cadence −0.06 (n=16) — no relationship.** A weak LAGGED signal (this
      month's rain vs NEXT month's respray rate) r=+0.40 (n=9) is suggestive but small-n/noisy; the
      next-month cadence lag (−0.56) is an end-of-season small-sample artifact (e.g. Oct-2024 100% off
      a tiny gap count). **Takeaway:** rainfall did NOT systematically rise 2024→2026, yet cadence
      >17d went 2024 low → 2025/2026 high — so the cadence/spray-gap decline (§5.17) is
      **capacity/routing, not weather**, reinforcing the retention-cohort item above. Not worth a
      dashboard widget on this data; revisit the lagged respray signal if more seasons accrue.
- [x] ~~**Is the 9-day respray window right?**~~ RESOLVED by ops (rev 39): the window governs when a
      re-service is **booked**, not when it completes — rain/capacity push visits later. All 39
      "outside window" jobs are legitimate resprays again; the gap is now an informational marker.
- [ ] **Return rate has fallen every season for five seasons (−5.0pp: 82.3 → 77.3%)** — surfaced by
      the rev-33 trend (§5.17). The denominator grew over the same span, so this is retention, not
      sample size. Worth an ops conversation on cause before building more measurement: the data now
      supports a cohort cut (by marketing source, route/tech, LI vs Westchester, tenure) using
      `realgreen_jobs_history.source_code`/`source_description`, which is loaded for 2021-2023.
- [x] ~~`/leads/followup`: should "No open task" count as Overdue?~~ RESOLVED by UPDATE-RL-04
      (rev 25) — the whole task-only model was replaced with the notes+tasks model
      (never_reached / loop_not_closed / working_on_track / working_overdue). See §5.11.
- [ ] "Real lead" definition for close rate — pending Rivka & Leon (drops into isRealLead() hook).
- [~] Return-rate mid-season-cancel decision — RESOLVED by the 2026-07-07 ops override: metric is
      now completed-service-based ("served in Y, receiving in Y+1"), single rate per pair, no dual
      denominator. On-Hold counts as returned (paused ≠ cancelled). See REFERENCE §5.8 / §9 #8.

## Worklist / cleanup (not code) — surfaced live on /sales → Return-rate anomalies
- [ ] **117 anomaly records to fix in Pocomos** (self-clearing — each drops off the card on the next
      refresh once fixed). **83 duplicate customer records** (merge the twins; keep the one with the
      live contract) · **26 export customers with no confident match** (give the duplicates distinct
      emails, or merge) · **8 unreadable mosquito histories** (make the mosquito contract the
      customer's active/default contract) · **0 sprayed-without-a-tag**. Live roster with reasons +
      profile links is on the card itself. See REFERENCE §5.10.

## Ready to build (unblocked) — accuracy follow-ups
- [ ] **Duplicate web records distort the return rate by +3 (≈0.2pp).** Pocomos spawns a NEW customer
      record on lead conversion instead of reusing the old one, so one human can hold 2+ web ids
      (113 emails cover 238 records). The bulk export knows them as ONE short id, so its counts land
      on a single twin (idMap prefers active → most-recently-serviced) and the twin shows a phantom
      zero. Measured impact: exactly 3 customers are 2025-real non-returners whose TWIN returned
      (numerator 948 → 951, 77.3% → 77.5%). Fix = a household/identity merge (group web ids by
      email+address, union their counts+tags before the rule runs). Also inflates the cosmetic
      "zero-2025" tally (42 → 76). See REFERENCE §5.8 "Known artifact".
- [ ] **~26 unresolved short ids in `customer_id_map`** — same email AND name across several web
      records, so every tie-break ties. They fail closed: their jobs are dropped (151 jobs/21 ids in
      2024, 93/12 in 2025 ≈ 1%), so those customers are missing from the denominator. Fix likely
      falls out of the identity-merge item above. See REFERENCE §5.9.
- [ ] Marketing-source analysis now that `realgreen_jobs_2024.SourceCode`/`SourceDescription` are
      loaded (33 distinct: "Friends & Family", "Direct Contact", "Previous Customer", "Affliate",
      "Newspaper Insert", …). Pairs with the existing "Top converting lead sources" item.

## Worklist / cleanup (not code)
- [ ] Apply a 2026 tag (or confirm cancellation) for the **10 Missing-tag active customers** on
      `/sales` → Missing tags (8 carry a 2025 tag = not renewed; 2 have no prior-year tag at all,
      flagged "no prior tag"). Live roster is on the card (name/id/tags/last service/Profile).

## Recurring (yearly ritual)
- [ ] **When a season ENDS, move it from scrape to export.** `scrapedYears()` returns `[CY]` only;
      every older year MUST be export-backed or it silently reverts to the broken contract-scoped
      scrape. Steps: pull the Pocomos completed-jobs CSV for the whole year (ALL branches —
      Westchester exists from 2026; 2025 was LI-only because Westchester hadn't started), drop it in
      `data/`, add a loader branch, run `scripts/load-exports.ts` then `scripts/verify-rev18.ts`.
      Full ritual + gotchas (\r\r line endings, M/D/YY dates) → REFERENCE §5.9.

## Ready to build (unblocked) — accuracy follow-ups
- [ ] **PhoneBurner call coverage is thin for the follow-up cross-ref.** `webhook_log` holds only
      293 recent disposition rows and its `pocomos_id` is NULL on every row (must bridge via
      `pb_contact_id → phoneburner_contacts`). Only 5 of 288 scope leads have any call event, though
      136/288 are synced to PB. To make the "PB calls" column meaningful we'd need to backfill call
      history from the PhoneBurner API rather than rely on webhooks only. See REFERENCE §5.11.
      **PROBE (rev 47, 2026-07-20): YES, PB exposes historical calls — via the `/dialsession`
      resource.** Structural probe of `phoneburner.com/rest/1` (401=exists / 404=no, calibrated
      against known endpoints): **`GET /dialsession` (list) and `GET /dialsession/{id}` both exist
      (401)**, as do `/contacts`, `/members`, `/folders`, `/tags`. There is **no** `/calls`,
      `/calllog`, `/dialsessions`, `/callanalytics`, `/reports`, or any contact-level
      `/contacts/{id}/calls|history` endpoint (all 404). So the backfill path is: page `/dialsession`
      (each dial session = a completed calling session carrying its calls + dispositions + the
      **member/CSR** who dialed and timestamps), then join to contacts. **Why this matters for Rena:**
      the webhook data can't attribute per-CSR — all 293 `webhook_log` rows record `csr_name =
      "Ohavia Feldman"` (the API-account owner, not the dialing CSR), whereas a dial session carries
      the actual member. **Volume NOT measured live** — `PHONEBURNER_TOKEN` is sensitive in Vercel
      (env-pull returns empty) and absent from `.env.local`, so an authenticated probe needs the token
      added locally or a short-lived deployed probe route; the structural existence of `/dialsession`
      is confirmed. Webhook capture so far: 293 rows, 2026-05-28 → 07-17, dispositions No Answer 216 ·
      Not Interested 37 · Left Message 15 · Set Appointment 10 · Bad Phone 5 · etc.
- [ ] Fix `webhook_log.pocomos_id` at write time (webhookProcessor) so future rows join directly
      instead of needing the pb_contact_id bridge.

## Ready to build (unblocked)
- [ ] **`/finance` payment-retry review** — the Finance page is scaffolded (currently hosts the
      shared paused-balance roster). Next tenant: review/queue failed-payment retries so paused
      accounts get unblocked. See REFERENCE §5.14.

## Blocked — needs a share/permission
- [ ] **⚠️ SHARE the "2026 Master Routing List" sheet with the service account.** The Drive/Sheets
      APIs are enabled and the payroll sheets + the Technician roster sheet are readable, but the
      Master Routing sheet (`1EPKjgwaFEA-q_QpvBXSAyL14V-3JxPIAJaNggefCA0o`) returns **403
      PERMISSION_DENIED** — it was never shared with `payroll-reader@referral-hub-500201.iam.
      gserviceaccount.com`. Share it **read-only** and `/tv/board` + `/service/board` light up the
      tech-first CALENDAR rows, day notes, and sheet announcements automatically (masterRouting.ts is
      wired and dormant). Until then those boards run off Pocomos + the DAYCODES snapshot.

## Done (recent)
- [x] **PASSWORD + NAV + SALE BELL + CTA + BOARD V2 (revs 58-62, 2026-07-22)** — texting password
      rotated (cookies invalidated by design; Proganic typo fixed); nav taxonomy Customers · Leads ·
      Service · Finance · Texting · Requests · TV (/combined + /calling deleted with permanent
      redirects; /tv/board added to TV dropdown; standing new-page-nav rule in CLAUDE.md + skill);
      /tv/sales new-sale bell (3 synthesized WAVs, Sat-Fri weekly tally vs Saturday snapshot,
      once-per-week milestones in sync_state, autoplay affordance, /sales subtle tally); /finance
      collections CTA redesigned (gradient glow + LIVE panel); board v2 weekly mirror (Sun-Fri
      6-col current week, ?week= review, urgent banner, special-code pills, Day Code parser fix,
      announcements seeded). Reports: 2026-07-22-nav-bell-board.md.
- [x] **Feedback bubble "Record screen" with mic narration (rev 56, 2026-07-22)** — third capture
      option (Attach file / Take screenshot untouched): getDisplayMedia + getUserMedia mic →
      MediaRecorder (vp9/opus preferred, mic-denied → silent fallback with note), 60s max +
      countdown + Stop + mic-hot indicator, preview-with-audio → attach/discard, MAX_VIDEO_BYTES
      3 MB (auto-stop at 95%), `feedback.video_data_uri` + `hasVideo` + GET /api/feedback/{id}/video,
      /requests Video tile → full-screen playback with audio. Landmine logged: recorder.mimeType's
      `;codecs=vp9,opus` comma breaks data-URI parsing — client stores the bare container mime.
      E2E-verified live (real Chromium MediaRecorder); test row cleaned up. See §5.18.
- [x] **Cash-register moment on /finance + Collections Mode (rev 55, 2026-07-22)** — new
      `balance_clearances` log (full clears only, per-day ring-once dedupe), detection in the
      mosquito refresh (prior-balance diff, eligibility + empty-report guards) AND a lightweight
      `POST /api/finance/collections-check` (fresh unpaid pull ~2.4-3.4s measured). /finance gets a
      passive since-you-last-looked celebration (WebAudio cha-ching, flying amounts, mute persisted,
      autoplay-blocked → replay affordance) + "Start collections session" (visibilitychange re-check
      + 20s poll, per-clear ring, row slide-out, session tally, 10-min idle auto-stop). Display-only;
      never /tv/*. Open follow-up: Pocomos card-processed → invoice-paid latency unmeasured — first
      real session validates. See §5.14b. **Same-day rev-57 probe:** the unpaid report is
      past-due-only (0 of 83 invoices future-due; installment invoices surface only once due), so
      open_balance = OVERDUE balance and the zero-test is installment-safe — no code change.
- [x] **Historical webhook-notes backfill (rev 54, 2026-07-21)** — 251 of 290 dead-parser-era calls
      (Jun 4–Jul 16) now have v2 Pocomos notes with the original call date + `Email sent:` where one
      went out (202). Test-folder dials excluded (ops); 0 today/wellness rows (safety-checked);
      call_id gate held across three attempts (no double-writes). Two resolve landmines found +
      fixed on the way (find-customer is session-only AND can't see cancelled customers → contact-
      details bridge; live route got a customers-table fallback). Remaining 39 = lead records
      blocked on the dead lead-note endpoint (open item above).
- [x] **Wellness-calls campaign (rev 51, 2026-07-21)** — self-refilling PhoneBurner queue of active
      customers with 2+ completed mosquito sprays this season. Two EXEMPT folders (Queue 66255089 /
      Called 66255090), `sprays_this_season` counter (aggregated from `respray_jobs` — no scrape;
      5/5 spot-checks matched the service-history page), `wellness_calls` season guard, webhook
      fall-out (any disposition → record + move to Called + direct Pocomos note), daily 07:00 feeder
      cron with `?dryRun=1`. Built + deployed; **queue NOT live-filled yet** — see the go item below.
      See §5.21.
- [x] **/tv/board v2 tech-first + /service/board + compliments (rev 50, 2026-07-20)** — Master Routing
      CALENDAR now primary (tech-first rows, Pocomos fallback), ant/electric-blower markers, legend,
      editable announcements, new-customer box, day notes. New /service/board browser mirror + shout-out
      form + management. Compliments: roster from Technician sheet col A only (8 techs), nightly cron,
      7-day shout-outs panel on both boards, soft-delete. Yodeck-safe, verified live. See §5.19/§5.20.
- [x] **Feedback bubble upgrades + CALENDAR overlay (rev 49, 2026-07-20)** — Take-screenshot
      (html2canvas) with an arrows/boxes/freehand markup step; name required + remembered in
      localStorage; /requests by-submitter filter + per-person counts. Master Routing sheet shared →
      corrected CALENDAR parser lights up tech-first rows on /tv/board (verified live). See §5.18/§5.15.
- [x] **Referral scanner LIVE (rev 48, 2026-07-20)** — Drive/Sheets APIs enabled + creds set, so the
      nightly `/api/cron/referrals` now reads the live payroll sheets. Fixed `matchTechnician`: the
      real tabs are **"LAST, F"** (first initial only), so it's surname-anchored (Levenshtein ≤2 for
      spelling drift) with first-initial tie-break, not two full tokens. Live scan matches the seed
      exactly: **Nicholas Rosales ← Channa Noiman, Nathaniel Tapscott ← Mina Becher.** See §5.15.
- [x] **Emoji sweep on browser pages (rev 46, 2026-07-20)** — last 🎉/🏆 on /sales + /service/* now
      lucide SVG (status-icons.tsx), consistent with the TV boards. Polish.
- [x] **BUILD-SCHEDULE v1 — /tv/board digital route board (rev 45, 2026-07-20)** — Yodeck-safe TV
      schedule board: today + next 4 workdays, per-day weather + route codes + towns + stop counts,
      from Pocomos (next_service_date + route_code) and a DAYCODES-tab snapshot; live Electric-Blower
      marker. Sheet-driven tech names + ANT rain markers dormant until Drive/Sheets APIs enabled
      (same blocker as referral scanner). Display-only, no writes. See §5.19.
- [x] **WC season-bucket fix — Westchester is year one (rev 44, 2026-07-20)** — WC customers with the
      0-Westchester tag (or ZIP 105xx-108xx) whose only prior-year evidence is a TAG (no spray history
      with us) now count NEW, not Season-Skipped, because the territory was bought from a prior
      operator. **New 149 → 199, Season-Skipped 89 → 39 (50 moved), Returning + total unchanged.**
      New isWestchester() helper; /sales tile defs updated. See §5.8.
- [x] **FEEDBACK-SYSTEM — in-dashboard feedback + /requests review queue (rev 42, 2026-07-19)** —
      floating feedback bubble on every dashboard page (not /tv/*): text + optional name + optional
      image (downscaled client-side), auto-captures page URL + time, stored in a new `feedback`
      table (images base64 inline). New **Requests** nav tab → /requests: newest-first list with
      thumbnails, click-to-cycle status (New/Selected/Shipped/Declined), status filters, and a
      **prompt builder** that turns ticked items into a paste-ready /ship prompt (auto-marks them
      Selected). No cron, no auth (POST lightly rate-limited). Verified end-to-end live. See §5.18.
- [x] **TV ticker reworded to "Team best" (rev 40, 2026-07-19)** — it could name a different tech
      than the Clean Streak tile (109 Daniel vs 108 Jason) because the ticker is the season maximum
      and the tile is an award seat. Fixed the label, not the number (echoing the tile would have
      printed a figure lower than the real best); now computed over all techs. See §5.12.
- [x] **Respray rule corrected + pending-re-service maturity (rev 39, 2026-07-19)** — the ~9-day
      window is a **booking** rule, not a completion rule (rev 38 had it wrong and dropped 39 jobs):
      **resprays 60 → 99, team rate 1.11% → 1.84%**, long gaps now just carry a "late visit" marker.
      Proven-clean now also requires **no re-service on the books**; detection probed on
      `/scheduled-services` (Type="Re-service", Status="Pending", ~1 in 166), **385 ms/customer,
      pooling doesn't help**, scoped to most-recent-spray 8-21d = **514 customers / 198 s** as a
      nightly cron phase. Matured clock → Jun 28-Jul 3. Cesar 500/9 = 1.80%; ticker 5,393 · 1.84%.
      See §5.12.
- [x] **Respray window + maturity + two clocks + awards-only exclusion (rev 38, 2026-07-19)** —
      respray = re-service **within 9 days** of the prior spray (supersedes the rev-24 windowless
      rule); beyond that = anomaly, counted but unattributed and listed for review. **Attributed
      resprays 99 → 60, team rate 1.84% → 1.11%, 39 anomalies.** Maturity (9d) drives a second clock:
      VOLUME awards use the last completed week (Jul 12-17), RATE awards the most recent fully-proven
      week (Jul 5-10); every tile prints its own dates + a rule footer. Cesar and `Z-*` are now
      excluded from **awards only** — **ticker corrected 4,892 → 5,393 sprays**. New season-pace card
      (5,393 vs 5,185 by the same date last year, +4.0%). See §5.12.
- [x] **Cadence health stat card (rev 37, 2026-07-19)** — `/service/resprays` now tracks the share of
      consecutive-service gaps beyond the 11–17 day window, live for the current season:
      **2024 9.1% · 2025 27.8% · 2026 31.1% (live, +22.0pp vs 2024)**. Makes the §5.17 spray-gap
      finding a watchable leading indicator. ⚠️ counts gaps **strictly >17d** (17 is on target) — the
      earlier ad-hoc figures (12.3/35.4/38.7%) included exactly-17-day gaps. See §5.12.
- [x] **Spray week → SUNDAY–FRIDAY (rev 36, 2026-07-19)** — ops: the crew sprays Sun–Fri, never Sat.
      `weekStart()` now returns the ISO Sunday; tech board (landscape + tall), resprays weekly
      leaderboard, Most Improved and all bucketing moved together. Bucket is Sun–Sat (Saturday
      structurally empty, kept so stray Saturday jobs can't vanish); displays Sun–Fri. **Board rolls
      over on Saturday** = the most recent Sun–Fri week that has fully ended. Tie-out verified against
      the LIVE Pocomos report: Nathaniel Jul 12–17 → 146 rows = 115 counted + 31 excluded, exact.
      New `scripts/verify-week-tieout.ts`. See §5.16.
- [x] **TV emoji → inline SVG icons (rev 35, 2026-07-19)** — Yodeck's Linux browser has no
      color-emoji font, so every award/weather glyph was an empty box on the real screens. New
      `components/tv-icons.tsx` (lucide): per-award accent colors in gradient badge discs with a soft
      glow, tinted weather SVGs, droplet for precip. Emoji fields removed from `AwardDef` /
      `ForecastDay` so none can come back. `scripts/verify-tv-icons.ts` asserts zero emoji in the
      rendered DOM at all five sizes. See §5.16.
- [x] **FIX: fleet-count CSVs 404'd on Vercel (rev 34, 2026-07-19)** — Google Sheets IMPORTDATA was
      failing with "Resource at url not found". Cause: **an App Router route segment containing a dot
      404s on Vercel** (serves fine under `next start`) — the platform resolves extension-looking
      paths against the static filesystem. Handlers moved to dot-free paths + `beforeFiles` rewrites;
      public `.csv` URLs unchanged, 200 + text/csv, no redirect. See §5.14.
- [x] **2021-2023 history + 5-season return-rate trend (rev 33, 2026-07-19)** — the return rate is
      now a TREND, not two points: **82.3 → 80.7 → 79.6 → 78.9 → 77.3%**, a **−5.0pp decline every
      single season**, while the real-customer denominator GREW 1,061 → 1,296. That's retention
      sliding, not a shrinking sample — **worth an ops conversation.** New `realgreen_jobs_history`
      + `return_rate_history`, `scripts/load-history.ts`, sparkline on `/sales`, arc caption on
      `/tv/sales`. History is computed in RealGreen short-id space (the id map would have inflated
      23→24 by +17.3pp); the spray-only-vs-tag seam is measured at ≈1.9pp and encoded in the UI.
      See §5.17.
- [x] **TV nav dropdown (rev 32, 2026-07-19)** — new **TV** tab in the top nav → Sales board /
      Tech board / Tech board — narrow. Items open in a **new tab** (`/tv/*` renders without the nav,
      so an in-tab link strands the user); new opt-in `NavLink.matchPrefix` lights the tab across
      `/tv/*` without making Sales double-highlight with Finance. `scripts/verify-nav-tv.ts`.
      See §5.14.
- [x] **TV-TECHS-TALL 2×3 award wall — rotation REMOVED (rev 31, 2026-07-19)** — all six awards are
      now visible at every size; the 15s 3-up rotation is gone. Root cause of rev 30's cramped tiles
      was the **one-column grid wasting the slot's width**, not the tile count: the same ~470×430
      slot now shows a **2×3 wall at 222×89px per tile** (vs ~44px rows). `columnsFor(w,h)` —
      tall-and-narrow → 1 col, ≥1000px wide → 3 col, everything else → 2 col. Tile type scales off
      the measured tile box (`min(tileH×0.20, tileW×0.125)`), width capping the scale so long stats
      don't truncate. Verified 470×430 (2×3) / 550×700 (2×3) / 600×900 (1×6) / 1200×600 (3×2),
      0 clipped. See §5.16.
- [x] **TV-TECHS-TALL award TILES + adaptive rotation (rev 30, 2026-07-19)** — awards restored to
      tiles matching the landscape board (label + emoji + big first name + stat); 1 column at Yodeck
      widths, 2 only ≥900px. Adaptive: all six when rows clear 76px, else rotate 3 at a time with a
      15s cross-fade (the real ~470×430 slot). Tile type sized from the measured row height, so tiles
      can't clip. Verified 470×430 / 550×700 / 600×900 / 1200×600. See §5.16.
- [x] **TV-TECHS-TALL — `/tv/techs/tall` narrow board + weather (rev 29, 2026-07-19)** — right-column
      Yodeck widget: `https://ms-operations-hub.vercel.app/tv/techs/tall`. Weather strip (Open-Meteo,
      free/no key, display-only, 30-min module memo, fail-soft) + header + six one-line award rows +
      YTD ticker; no bottom table. Breakpoint-free `clamp(min,Nvw,max)` sizing, verified 500×450 →
      600×900 with no overflow. Landscape `/tv/techs` unchanged. See §5.16.
- [x] **TV-TECHS — `/tv/techs` shop-TV Tech Board (rev 28, 2026-07-19)** — Yodeck webpage-widget URL
      `https://ms-operations-hub.vercel.app/tv/techs`. 1080p, self-reloads every 10 min, no
      interaction. No new scrape/cron — computed on read from `respray_jobs` +
      `mosquito_service_status` (route join probed at 99.7%). Board week = last COMPLETED week (the
      live week has 0 mature resprays). Six positive awards, Cesar excluded, every tech guaranteed a
      callout via maximum bipartite matching. See §5.15.

## Ready to build (unblocked) — /tv/techs follow-ups
- [x] **TV-TECHS-REFERRAL — spinning referral trophy (rev 41, 2026-07-19)** — SHIPPED. Data source
      is the **weekly payroll Google Sheets**, not Pocomos: a referral = an OTHER PAY row of exactly
      **$50** with a customer name in NOTES. Spinning gold trophy hero on both boards + a month-long
      "boosted" star on every tile the referrer wins. Scanned 6 weeks: **Nicholas → Channa Noiman
      (wk 07-10), Nathaniel → Mina Becher (wk 06-26)**. See §5.15.
- [ ] **⚠️ ENABLE Google Drive API + Sheets API for the referral scanner (rev 44 — one console click
      away).** Credentials ARE now set + verified: service account
      `payroll-reader@referral-hub-500201.iam.gserviceaccount.com`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` /
      `GOOGLE_PRIVATE_KEY` live in `.env.local` AND Vercel Production (key round-trips to the exact
      PEM; JWT auth succeeds). The parent folder is shared read-only. **The ONLY remaining blocker:**
      the scan 403s with *"Google Drive API has not been used in project 325864948081"* — the
      **Drive API and Sheets API are not enabled** in GCP project `referral-hub-500201`
      (#325864948081). Enable both at console.cloud.google.com → APIs & Services → Enable APIs (Google
      Drive API + Google Sheets API), wait ~2 min, then trigger `/api/cron/referrals`. Zero code
      change needed — resolution + creds are all in place. Until then `referral_awards` stays on the
      `scripts/seed-referrals.ts` seed (board shows Nicholas→Channa Noiman, Nathaniel→Mina Becher).

## Recurring (yearly ritual)
- [ ] **NEW YEAR → make the payroll year folder (referral scanner).** Every January, create a folder
      named exactly `{YEAR}` (e.g. `2027`) inside the shared **"Payroll Calculator - MS"** parent
      (`1EP1fMZrPMaCnx3lY2rt3DYOM-v8kwAwF`), same as prior years. **Nothing else** — no code, no env,
      no redeploy. The scanner resolves the current year's folder by name at runtime (rev 43,
      `resolveYearFolderId`). If the folder is missing the cron logs a clear "create a {YEAR} folder"
      error and simply skips — it never crashes. See REFERENCE §5.15.

- [x] **BUILD-SPEEDUP tooling (rev 27, 2026-07-19)** — Playwright MCP in `.mcp.json`; `scripts/lib/`
      (livecheck / pocomos / csv / neon) + `scripts/verify-live.ts`; skills `pocomos-scraping` +
      `dashboard-conventions`; `/ship` command; CLAUDE.md slimmed to identity+rules+pointers.
      Deleted 44 obsolete one-off scripts (71 → 27 + 4 lib). Rule added: verify deployed UI via
      Playwright, not curl+regex. See §11.2.

## Monitor (not blocking)
- [ ] **`/service/resprays` SSR HTML consistently disagrees with its own API — REPRODUCED twice.**
      The page is `force-dynamic`, so both paths call `getRespraysReport()` at request time against
      the same Neon table, yet they disagree:
      - rev 37: page cadence 2026 = **31.8% (1,330/4,182 gaps)** vs API **31.1% (1,331/4,282)**
      - rev 38: page anomalies = **38** vs API **39** (API polled 5× — 39 every time; page stable
        at 38 across repeated loads, cache-busting query param included)
      Stable-on-both-sides rules out read-replica jitter or a mid-refresh partial read; each render
      is internally consistent, so it is a **stale SSR snapshot being served from cache**, not a
      logic bug. The API is the trustworthy number. Next step: inspect `cache-control` on the page
      response vs the API response, and check whether Vercel is edge-caching the `force-dynamic`
      HTML; if so, the page needs an explicit no-store header. Numbers quoted in docs come from the
      API.

- [~] **Vercel auto-deploy** — VERIFIED WORKING rev 27 (a push produced a git-triggered
      `…-git-main-…` deployment, no CLI). Has flaked before, so keep confirming a fresh deployment
      after each push; if it starts missing again, the dashboard levers are in REFERENCE §11.2.

## Done (earlier)
- [x] **RL-04 follow-up: CLOSED-OUT bucket + collapsible sections (rev 26, 2026-07-19)** — split the
      old loop_not_closed (234) into **closed_out 185** (task completed, none in progress — done
      reaching out; section shows closing description / completion date / salesperson / Not-Interested
      reason / lead link) and **loop_not_closed 49** (reached, no task ever completed). /leads/followup
      reworked to collapsible per-bucket sections (obvious one-click view per category). See §5.11.
- [x] **RL (Mrs. L) feedback pack — UPDATE-RL-01 / RL-03 / RL-04 shipped (rev 25, 2026-07-18)** —
      **UPDATE-RL-01 (dup detection):** drop "…duplicate…"-named shells; a shared email now needs
      NAME IDENTITY (same last name + fuzzy first) to be a dup, so father/daughter shared inboxes
      aren't flagged. **Dup groups 83 → 59** (25 shell records / ~15 groups + 9 name-mismatch groups
      removed). **UPDATE-RL-03 (needs manual check):** resolve add-on customers who render a
      non-mosquito contract from the completed-jobs cache (`respray_jobs`) instead of flagging.
      **needs_check 7 → 0** (Chana Lovi + Susan Badalbayev cleared without the Monday tag fix — 6
      current, 1 overdue). **UPDATE-RL-04 (/leads/followup reclassification):** added a Lead Notes
      scrape (`/lead/{id}/lead-information` `#notes-table`; the bulk `/all-notes-data` feed is
      customer-only). New buckets: **never_reached 43 · loop_not_closed 234 · working_overdue 6 ·
      working_on_track 7** (tasks & notes treated separately per ops). See §5.5 / §5.10 / §5.11.
- [x] **Respray pack: RESPRAY-RULE-CHANGE + RESPRAY-WEEKLY + RESPRAY-CHAIN (rev 24, 2026-07-17)** —
      **RESPRAY-RULE-CHANGE:** respray = ANY re-service this year (10-day window dropped); attributed
      to the most recent prior mosquito job's tech, INCLUDING prior re-services (chain rule).
      Denominator unchanged. **Team 1.30% → 1.84% (+29 resprays; 99 attributed, 3 chain, 0
      unattributed)**; only Nicholas Rosales flagged (3.12%, 1.70×). **RESPRAY-WEEKLY:** "This week on
      the board" leaderboard — current + last full week, per-tech stats, Best/Watch callouts (20+
      apps), auto-stats (streaks, most-improved, perfect week). **RESPRAY-CHAIN:** chain badge in
      drill-down rows (blamed prior job was itself a re-service) + "Repeat respray customers" card
      (2+ resprays this year; 8 live). See §5.12.
- [x] **Nav dropdowns + `/finance` + public fleet-counts feed (rev 23, 2026-07-17)** — Service and
      Sales became click-driven nav dropdowns (same `NavDropdown` as Leads; Service → Overdue
      sprays / Respray performance, Sales → Sales / Paused—open balance); new Finance tab. New
      `/finance` page renders the shared `PausedBalanceCard` (extracted with `RowTable` into
      `components/service-rows.tsx`; `/service/overdue` uses the same component — no copied code).
      Public `/api/fleet-counts` (JSON) + `/api/fleet-counts.csv` (Sheets), totals only, from the
      nightly `mosquito_service_status` table: **customer_total 1,156 · service_total 1,175** (19
      weekly counted twice; van gauge ≈4.7 @ 250/2wk). See §5.14.
- [x] **`/service/overdue` "sprayed today but shows overdue" FIXED (rev 22, 2026-07-17)** — routes
      109/209 customers showed overdue on the day they were sprayed. Causes: (1) overdue cache's
      last-spray lags Pocomos's bulk "Last Service" (tech completions sync hours late); (2) bulk
      `next_service_date` is a stale PAST slot, so the scheduled-today rule (`next==today`) misses
      them. Fix: sprayed-today read-time rescue — cross-check `respray_jobs.completed_date =
      easternToday` (mosquito-only); those rows go green + excluded, precedence sprayed > scheduled
      > ASAP > overdue. `refreshMosquitoStatus` now refreshes `respray_jobs` so Refresh-now reflects
      same-day sprays. Verified: 8 overdue rows sprayed 2026-07-17 all moved out, 0 left. See §5.5.
- [x] **NEW `/service/resprays` "Tech Respray Performance" (rev 21, 2026-07-17)** — respray rate by
      tech from the Pocomos completed-jobs report (Symfony form POST → server-rendered
      `#results-table`; ONE POST = whole year, 6,246 rows in 3.2s, no per-customer scrape). Ops
      rules on the card: respray = re-service ≤10d after that customer's prior mosquito application,
      blamed on that prior spray's tech; 11+d = normal cadence (11–17d), not counted; CY only.
      **Live: 97 re-service jobs · 69 counted · 28 excluded · 0 unattributed · 5,294 apps · team
      1.30%.** Only Nicholas Rosales flagged (2.59%, 1.99× team, 1,041 apps; flag = ≥1.5× avg AND
      ≥30 apps). Cache `respray_jobs` + cron `0 8 * * *` + Refresh-now. Flipped the `/service`
      "Tech Respray Performance" stub live. See §5.12.
- [x] **`/leads` "Updated 749h ago" FIXED (rev 21)** — root cause: the close-rate cache had **no
      cron**; `refreshCloseRate` only ran from the manual Refresh button or on GET when the row was
      *missing*, so a stale-but-present row survived forever (~31 days). NOT conversion-sweep (that
      only does PhoneBurner folder moves). Added cron `/api/cron/close-rate` `0 9 * * *` and
      refreshed (424 leads · 113 conversions · 26.7%). See §5.13.
- [x] **Leads nav dropdown (rev 21)** — Close rate + Follow-ups; click-driven (works on touch,
      closes on outside-click/Escape/navigation); Leads tab highlights on any `/leads/*` page.
      `CollapsibleSection` extracted to `components/ui/collapsible-section.tsx`, shared by /sales +
      /service/resprays.
- [x] **NEW `/leads/followup` "Overdue Follow-ups" page (rev 20, 2026-07-17)** — open leads created
      this year (status=Lead + date_added in CY; 288 live), classified by follow-up task state:
      **Overdue 1 · No task 92 · No open task 185 · On track 10**. Nightly cron `0 7 * * *` →
      `leads_followup` + Refresh-now button; page reads cache only. Probe: `/leads/data` already
      carries status + reason + marketing type (no per-lead lead-information scrape); tasks are
      server-rendered on `/lead/{id}/message-board`; comment timestamps need `/message/todo/{id}/show`.
      Cost ~416 GETs / ~229s, 0 failures. PB cross-ref via the pb_contact_id bridge (sparse — 5/288).
      See §5.11.
- [x] **"Returned" rule widened + buckets partition again + anomalies card (rev 19, 2026-07-17)** —
      returned in Y+1 = active now with ANY {Y+1} tag (signing up = returning, sprays not required,
      New Sale re-signups included) OR meets the Y+1 spray rule regardless of status (credits
      sprayed-then-churned); applies to BOTH pairs (rev 18's in-progress-only tag path lifted).
      Denominator unchanged. **24→25 = 78.8% (1,006/1,276)** (was 77.8%, +1.0pp; 808 tag/198 sprays).
      **25→26 = 77.3% (949/1,227)** (was 948; +4 New Sale, 3 moved spray→tag). Returning box 949.
      Season buckets partition restored: **New 150 + Season-Skipped 86 + Returning(active) 932 =
      1,168 = Active Customers**; all three tiles now taxonomy-driven (not categorize.ts); the 17
      sprayed-then-churned returners are named in the reconciliation line. New **Return-rate
      anomalies card** (§5.10, `lib/sales-anomalies.ts`) — live/self-clearing, 4 classes, 117
      records. See §5.8 / §5.10.
- [x] **Return-rate counts from bulk exports; 24→25 UNBLOCKED (rev 18, 2026-07-16)** — completed
      seasons now come from authoritative job-level exports (2024 RealGreen dump *received+loaded*,
      2025 Pocomos completed-jobs); only CY is scraped. Retires BOTH blockers: the pre-Pocomos 2024
      gap and the scrape's contract-scoped blind spot (Sherly Aminzadeh: scrape 2025 = 0, export = 6).
      **24→25 = 77.8% (993/1,276) LIVE** (was n/a since rev 15). **25→26 = 77.3% (948/1,227)** vs
      rev-17 75.9% (976/1,286) = +1.4pp. Returning box 948, still === numerator. New tables
      `realgreen_jobs_2024`, `completed_jobs_2025`, `customer_id_map` (short↔web built from contact
      details — Pocomos exposes the short id nowhere; 1,609/~1,635 mapped). New
      `mosquito_service_counts.source` + invariant "export years hold only export rows" (evicted 28
      2024 / 96 2025 stale scrape rows). Tag path narrowed to the in-progress season only. RealGreen
      codes validated empirically (12→Mosquito, 12N→Natural, 24→Mosquito-Weekly, 24N→Natural-Weekly;
      all mosquito). See §5.9.
- [x] **Import RealGreen dump → unblock 24→25 return rate** — DONE in rev 18 (above). The dump
      arrived 2026-07-16 and is loaded; 24→25 is live at 77.8%.
- [x] Return-rate full-history source / `table_ok=false` coverage gap — OBSOLETE as of rev 18. Both
      were artifacts of counting completed seasons from the per-customer scrape; the bulk exports are
      contract-agnostic, so the ~1-season render window and the unreadable-default-table gate no
      longer affect 2024/2025 at all. The PDF path is dead (ops: never accurate — REFERENCE §5.8).
- [x] **Return-rate + Returning-box unification (rev 17, 2026-07-16)** — ops-canonical. (1) "Real
      customer of Y" REVERSED from rev 16: ≥2 completed mosquito services in Y, OR exactly 1 dated
      AFTER Aug 15 (late-season signup); a single early/mid-season spray no longer counts. New
      constant REAL_CUSTOMER_MIN_SERVICES. (2) "Returned in Y+1" = real customer of Y+1 OR an ACTIVE
      customer with a Y+1 continuation tag (Auto/SEB/EB/Renewed); denominator stays rule-1-only.
      (3) The /sales + /tv/sales "Returning" box IS the numerator set (taxonomy.returningBox),
      restricted to prior-year real customers — box.total === pair.returned, asserted by
      scripts/verify-return-unification.ts. Kept Auto/SEB/EB/Renewed sub-counts, added
      "by spray history"; sub-counts partition the total. (4) Card description + the wrong
      "excluding late one-offs" label rewritten. sales-provider.ts untouched (buckets.RETAINED +
      retainedSubtypes remain the tag-only series feeding snapshots; no longer displayed).
      **Live 25→26 = 75.9% (976/1,286)** vs rev-16 76.5% shipped / 76.6% (946/1,235) recomputed
      = −0.7pp. Numerator: 954 by tag + 22 by spray history. Late-season signups counted real:
      2025=88, 2026=0. **Returning box 976** (Auto 404 · SEB 292 · EB 139 · Renewed 119 · spray 22),
      was 1,009 tag-only: 55 dropped (all denominator-membership, incl. 7 table_ok=false), 22 added
      (19 non-active + 3 untagged, all spray-qualified). See §5.8.
- [x] Return-rate "real customer" rule changed (rev 16, 2026-07-13) — replaced MIN_RETURN_TREATMENTS=2
      with: real customer of Y = ≥1 completed mosquito service in Y (Event Spray never counts) EXCEPT
      a single spray after LATE_SEASON_CUTOFF (Aug 15). Added first/last spray-date columns to
      mosquito_service_counts (backfilled via run-service-counts force re-scrape). Applied to both
      denominator (Y) and numerator (Y+1). Live 25→26 = 76.5% (945/1,235) vs old ≥2 rule 75.9%/76.2%;
      single-late excluded: 2025=89, 2026=0. 24→25 still n/a (truncation). See §5.8.
- [x] "Missing tags" section on /sales (rev 16, 2026-07-13) — ALL active customers with no CURRENT_YEAR
      tag (name/id/all tags/last service date/Profile link + stat header). Supersedes/absorbs the
      narrower "Customers with issues" card (now flagged inline with a "no prior tag" badge). Live: 10
      (8 not-renewed-with-prior-tag + 2 no-prior-tag). See §3.5.
- [x] /service/overdue ASAP-route rescue (rev 15) — overdue accounts with an upcoming job on the
      "Z-ASAP" route (Technician "Z-ASAP 01" + Route Assigned "Assigned" on scheduled-services,
      detected per-row) → own blue "On ASAP route" card + ASAP pill, excluded from the count
      ("Excludes N on ASAP route" sub-line). Cached in mosquito_service_status.asap_route, scraped
      for overdue rows only (17 rows/6.5s). Live: 3 on ASAP route. See §5.5.
- [x] /service/overdue scheduled-today section MOVED below the overdue table (rev 15; was above).
- [x] Return-rate REDEFINED to COMPLETED-SERVICE COUNTS (rev 15) — ≥2 completed mosquito services
      (Event Spray never counts) in Y AND Y+1. New resumable scrape serviceCounts.ts → 
      mosquito_service_counts (+ mosquito_service_scrape coverage), cron /api/cron/service-counts,
      card shows "(computing — N% covered)". Backfill: 1,816 cohort, 100% covered, ~850s.
      Live: 25→26 = 75.9% (911/1,200). 24→25 = n/a (service-history truncated — see follow-up above).
- [x] Return-rate rev 14 (SUPERSEDED by rev 15) — tag/last-service "served in Y" model. Replaced
      by the completed-service-count definition above; the rev-14 estimates (25→26 72.6%) are stale.
- [x] /sales return-rate card (rev 12/13; SUPERSEDED by rev 14) — tag-based real mosquito customers,
      primary + excl-mid-season denominators. Replaced by the service-based definition above.
- [x] /service/overdue scheduled-today → OWN green "Scheduled today" section (rev 13; was inline in
      the overdue table). next_service_date == today (Eastern), excluded from the overdue count.
      Read-time in getOverdueReport(). See §5.5.
- [x] /service/overdue sticky headers FIXED (rev 13) — removed the overflow-x-auto wrapper (it was
      the sticky scroll-context) + solid bg + z-20; header now pins on page scroll on all sections.
- [x] /service/overdue Route column (rev 13) — route CODE scraped from service-information
      "Routing"→"Code" into mosquito_service_status.route_code (incremental; ?forceRoutes=1 re-scrapes
      all). Full backfill ~1,021 codes in ~315s; ~0 steady-state. Shown between Customer and Contract.
- [x] Return-rate audit (rev 13) — scripts/audit-return-gap.ts + audit-return-gap.csv (gitignored);
      reconciled 25→26 numerator 1,079 vs Returning 1,004 (gap 130 = 123 inactive + 5 on-hold + 2
      active); card hint added. See §5.8.
- [x] /texting archive tab — Aerialink SMS history in a Neon-backed inbox (texting_messages +
      texting_contacts, imported via import-texting.mjs); left-pane list + threaded view. Gated by
      the app's only auth (TEXTING_PASSWORD + texting_auth cookie via src/middleware.ts). See §5.7.
- [x] Texting search made server-authoritative: /api/texting/search?find= queries the DB by
      phone/name so a full-number search always finds its conversation (not just the in-memory list).
- [x] Nav: Texting tab added to the top nav.
- [x] PhoneBurner: hourly roster-reconciliation conversion sweep (/api/cron/conversion-sweep,
      §5.5b) replaces the old conversionCleanup; */15 route is now notes-refresh only.
- [x] 2026-Renewed bucket fix (RETAINED ~991 / AT_RISK ~17)
- [x] Year-relative cancelled taxonomy + Not Renewed (377) + issues list
- [x] Sales relabel/reorg + inline definitions + reconciliation line
- [x] Overdue Profile link + day-based coloring + new-tab links
- [x] Visual polish pass (type scale + semantic color)
- [x] Leads tab scaffold (denominator + per-rep live; numerator pending)
- [x] Leads close-rate — SHIPPED & LIVE at /leads (v1 raw rate). Numerator + denominator via the
      Advanced Search two-step feed (set search[leadStatus][] for all five statuses, pull
      /lead/lead-advanced-search/data); cached in leads_close_rate table, custom ranges computed live.
      Conversions live: 76 / 324 = 23.5% YTD; per-rep + unattributed from the one feed. (isRealLead()
      hook stays raw pending the "real lead" decision above.)
- [x] Sales /sales + /tv/sales snapshot-first load with live background revalidation (GET
      /api/sales/live + useLiveSales()); contract-type breakdown rolled up into service families.
- [x] CLAUDE.md + REFERENCE.md consolidation
- [x] Docs truth-up: REFERENCE rev 10 (texting/sweep/leads-tab/tables LIVE) → rev 11 (full audit vs
      deployed code + live Neon information_schema, 2026-07-07); .gitignore for customer-data CSVs;
      import-texting loader synced (multi-file merge + NUL-strip).
