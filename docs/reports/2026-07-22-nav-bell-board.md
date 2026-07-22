# 2026-07-22 — PASSWORD + NAV-TAXONOMY + NEW-SALE-BELL + BOARD-V2 (+ CTA redesign) — revs 58–62

Five parts (Part 5 added mid-run), each its own commit + deploy, in order. Screenshots in
`docs/reports/2026-07-22-img2/`.

## Part 1 — Texting password (rev 58)

- `TEXTING_PASSWORD` replaced in Vercel Production (`vercel env rm` + `add`), redeployed (edge
  middleware only sees env at deploy). **Verified live: old password rejected, new accepted**
  (`scripts/verify-texting-password.ts`, 3/3). All existing texting cookies invalidate by
  construction (cookie = SHA-256 of the password) — everyone types the new password once.
- "Progranic" → **"Proganic"** typo fixed (1 occurrence, REFERENCE header). `.env.local` synced.

## Part 2 — Nav taxonomy (rev 59)

- Top bar: **Customers · Leads · Service · Finance · Texting · Requests · TV**. "Sales" renamed
  **"Customers"** (label only; routes untouched) and demoted to a **plain tab** — the old dropdown's
  "Paused — open balance" child removed (Finance owns /finance; double-highlight now impossible).
- `/combined` and `/calling` placeholder pages **deleted**; permanent redirects → `/sales` /
  `/leads` in `next.config.mjs`. Home-page cards realigned to the taxonomy.
- **Sweep result:** the only URL-only page was **`/tv/board`** → added to the TV dropdown
  ("Route board", new-tab like all TV items). Intentionally not nav entries: `/` (brand link),
  `/service` (dropdown landing, URL-only by design), `/texting/login` (auth flow).
- **Standing rule** added to CLAUDE.md + the dashboard-conventions skill: every new page ships
  WITH its nav entry in the same build — not in the nav = not shipped.
- Verified live 12/12 (`scripts/verify-nav-taxonomy.ts`): order, plain-link Customers, dropdown
  children, new-tab+noopener on all 4 TV items, only-Finance-active on /finance, both redirects.

## Part 3 — New-sale bell on /tv/sales (rev 60)

- **Three ORIGINAL synthesized WAVs** committed to `/public/sounds/` via `scripts/make-sounds.ts`
  (additive/bell synthesis, no licensed audio): `sale.wav` 2.6s bell + sparkle rise,
  `milestone-10.wav` 4.2s double bell + flourish + chord, `milestone-25.wav` 6.2s fanfare.
  Swap a file to change a sound.
- **Detection** rides the existing 5-min live poll: climbs of the live `buckets.NEW` ring
  sale.wav + "+N NEW SALE" splash + New-tile flash; drops stay silent. Last-seen count persisted
  (localStorage) so reloads don't re-ring but sales landed while the tab was closed ring once.
- **Weekly tally "This week: X / 25"** = live NEW − `snapshots.new_count` at the week-start
  SATURDAY (Sat–Fri sales week via `startOfSaturdayWeek`; fallback to the latest earlier snapshot).
  Rendered on the TV header; subtle version on `/sales` (browser page = NO auto-sound).
- **Milestones** 10 and 25 fire once per week, persisted server-side
  (`sync_state.sale_milestones_{weekStart}` via GET/POST `/api/sales/week-tally`) so kiosk reloads
  can't re-ring; a climb crossing a milestone plays the milestone sound INSTEAD of the +1 bell.
- **Kiosk audio**: autoplay-blocked → visual still runs + a one-time "Enable sound" button;
  **set-and-forget setup: Chrome → site settings for ms-operations-hub.vercel.app → Sound →
  Allow** on the kiosk machine. Mute toggle persisted.
- Verified live 12/12 (`scripts/verify-sale-bell.ts`, stubbed poll): tally renders, +2 climb →
  splash + sale.wav, crossing 10 → milestone-10.wav (not sale.wav), /sales subtle tally, WAVs
  served. Screenshots: `tv-sales-tally.png`, `tv-sales-splash.png`, `tv-sales-milestone.png`.
- **Bug found & fixed in-run:** climb handling raced the week-baseline fetch → milestones fell
  back to sale.wav; climbs now wait for the baseline to settle.

## Part 5 (mid-run addition) — /finance collections CTA (rev 61)

- Idle: large emerald-gradient button with DollarSign badge, "Start collections session / Track
  payments as they land", soft glow pulse (2.8s; off under prefers-reduced-motion).
  (Same-day tweak: sub-line was "Ring the register as payments land" — reworded audio-neutral so
  the register sound stays a surprise; kept a sub-line for the button's visual weight.)
- LIVE: transforms into a bordered emerald panel — pulsing dot, "Collections session LIVE",
  running tally, separate Stop button.
- Verified 6/6 (`scripts/verify-collect-cta.ts`); before = this morning's `2026-07-22-img/
  finance-flyer.png` (small outline button), after = `finance-cta-idle.png` / `finance-cta-live.png`.

## Part 4 — Board v2: true weekly mirror (rev 62)

- **Weekly grid**: current **Sun→Fri week, 6 columns always** (was today+4 rolling). Sunday renders
  even when empty; today ringed + TODAY badge; header "Week of Jul 19 – Jul 24"; flips Saturday
  (`resprays.ts::weekStart` + Saturday bump — the existing service-week convention; explicitly NOT
  the Part-3 sales week).
- **Split**: `/tv/board` display-only — verified **0 form elements**; `/service/board` = admin
  mirror (announcements, urgent, shout-outs) + new **`?week=YYYY-MM-DD` review override**.
- **Fallback days**: same row format with tech "—", labeled "not on sheet yet · Pocomos (mosquito
  only)", capped at 9 rows + "+N more". **Stop-count probe:** the counts are NOT wrong-1s — real
  per-route tallies (e.g. 7/22: 402=15, 602=10) from `mosquito_service_status.next_service_date`;
  they legitimately undercount the sheet (~30/route) because the table holds only eligible
  mosquito customers' single next service. Labeled honestly rather than inflated.
- **Markers**: ant bug marker confirmed on REAL sheet ANT days — **6/15 Cesar "ANT" and 6/16
  Nathaniel "608, ANT"** (rendered + screenshotted via `/service/board?week=2026-06-14`; other ANT
  days: 5/18 Mark "303, ANT", 5/19 Nathaniel "602, ANT"). The "Ant needs 3 dry days" caution is
  forecast-driven (Open-Meteo ≥55% precip within service-day+2) — logic unchanged, can't be forced
  without rain in the window. Weekly/special codes (WF/WG/RLW/TKO/ASAP/TMP/ANT) render as violet
  pills vs mono-sky numerics + legend chip. Electric-blower marker unchanged (live join).
- **Fidelity**: names/towns wrap, never truncate (verified 0 clipped elements at 1080p);
  OFF/OUT/RAIN render as status rows (Jun 18: Nick OFF, Daniel OUT + "Daniel called out" note
  line); sheet content mirrors verbatim — including a real sheet typo (Jason 7/22 shows 207
  stops). SERVICE CODES legend titled, SVG-only.
- **Announcements**: seeded from the physical board (THIS WEEK synthetic→NATURAL / NEXT WEEK
  →SYNTHETIC; seed fills empty fields only, never clobbers). New **URGENT ANNOUNCEMENT** field
  (`board_announcements.urgent`) — big red banner on BOTH boards, edited only on /service/board.
- **⚠️ Parser landmine found & fixed:** the sheet's hand-edited label row says both "DayCode" and
  "Day Code" — the strict match fell back to the Van column and **swapped daycode/van** (live on
  Jun 17–19). Now `/^day\s*code$/i`.
- Verified live 16/16 (`scripts/verify-board-v2.ts`) at 1920×1080 + 1440 browser: 6 columns,
  Sunday, TODAY badge, urgent banner (set → verified → restored), seeded announcements, legend,
  zero edit UI on TV, no emoji, no clipping, admin editors, ANT week + 2 bug icons.
  Screenshots: `tv-board-week.png`, `service-board-ant-week.png`.

## Numbers

- Nav: 9 top-level tabs → **7**; 2 placeholder pages deleted; 1 URL-only page (/tv/board) slotted.
- Sounds: 3 WAVs, 1.1 MB total.
- Weekly tally at verify time (real data): baseline = Saturday 7/18 snapshot `new_count`.
- Board week Jul 19–24: sheet had Mon–Wed (5 techs/day); Sun + Thu + Fri on Pocomos fallback.

## Judgment calls

1. **Bell series = categorize `buckets.NEW`** (live summary + snapshots series), NOT the taxonomy
   "New" tile — the baseline lives in `snapshots.new_count`, and diffing across two different
   definitions would be meaningless. The tile may read differently; the tally is internally
   coherent.
2. `/sales` page **h1 renamed "Customers"** to match the tab (spec said label-only tab rename;
   leaving the page titled "Sales" under a "Customers" tab read as a mismatch). TV board keeps
   its "Sales" title ("Sales board" in the nav).
3. Milestone POST failure is tolerated (fired[] refreshes on next GET) — worst case a re-ring
   after a crash, never a missed sale bell.
4. **First-visit tally/bell**: no localStorage → primes silently at the current count (no ring on
   first load of a fresh kiosk).
5. **`?week=` override lives on /service/board only** — added beyond spec to (a) let ops review
   any week and (b) verify the ANT marker against the real sheet day; the TV can never receive it.
6. Fallback stop counts left as-is (labeled "mosquito only") rather than scaled/hidden — honest
   data beats invented numbers; the sheet is authoritative when present.
7. Announcements seed fills only EMPTY fields — re-running never clobbers an ops edit.
8. Urgent banner capped at 300 chars; uppercase styling but stored verbatim.
9. verify-board's urgent test sets the banner live for ~10s, then restores the prior value — noted
   here since a TV mid-refresh could have flashed it.

## Verification (all live production, Playwright)

- Part 1: 3/3 (old rejected / new accepted / unauthed redirects).
- Part 2: 12/12 nav taxonomy + redirects.
- Part 3: 12/12 bell (stubbed climbs; real WAV serving).
- Part 5: 6/6 CTA states.
- Part 4: 16/16 board (1080p TV + browser admin + ANT review week).
- 6 production deploys total across the run (incl. two fix redeploys: bell race, Day-Code parser),
  each after clean `tsc` + `next build`.
