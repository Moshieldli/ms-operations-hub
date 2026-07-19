# Backlog — MS Operations Hub

## Ready to build (unblocked)
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
- [ ] Fix `webhook_log.pocomos_id` at write time (webhookProcessor) so future rows join directly
      instead of needing the pb_contact_id bridge.

## Ready to build (unblocked)
- [ ] **`/finance` payment-retry review** — the Finance page is scaffolded (currently hosts the
      shared paused-balance roster). Next tenant: review/queue failed-payment retries so paused
      accounts get unblocked. See REFERENCE §5.14.

## Done (recent)
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
- [ ] **TV-TECHS-REFERRAL** — 🏆 referral trophy as a top-billing award on `/tv/techs` (spinning
      trophy in the hero slot). **Blocked on the data source**: no referral/lead-attribution feed is
      wired up yet — Pocomos lead marketing_type is ~93% blank, so referrals credited to a tech will
      likely have to come from the converted customer's record or a manual sheet. Decide the source,
      then it's an entry in `AWARDS` (`topBilling: true, spin: true`) + a `computeCandidates` case;
      the view already renders the hero slot and the spin animation (`animate-spin-slow`). See §5.15.

- [x] **BUILD-SPEEDUP tooling (rev 27, 2026-07-19)** — Playwright MCP in `.mcp.json`; `scripts/lib/`
      (livecheck / pocomos / csv / neon) + `scripts/verify-live.ts`; skills `pocomos-scraping` +
      `dashboard-conventions`; `/ship` command; CLAUDE.md slimmed to identity+rules+pointers.
      Deleted 44 obsolete one-off scripts (71 → 27 + 4 lib). Rule added: verify deployed UI via
      Playwright, not curl+regex. See §11.2.

## Monitor (not blocking)
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
