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
- [ ] "Real lead" definition for close rate — pending Rivka & Leon (drops into isRealLead() hook).
- [~] Return-rate mid-season-cancel decision — RESOLVED by the 2026-07-07 ops override: metric is
      now completed-service-based ("served in Y, receiving in Y+1"), single rate per pair, no dual
      denominator. On-Hold counts as returned (paused ≠ cancelled). See REFERENCE §5.8 / §9 #8.

## Blocked (waiting on the user)
- [ ] **Import RealGreen dump → unblock 24→25 return rate.** HISTORY: the company ran **RealGreen
      before Pocomos; Pocomos data starts 2025**, so 2024 service history does not exist in Pocomos
      at all — 24→25 is not computable from anything we hold and the card shows "n/a"
      (`reliable=false`). The user will supply a **RealGreen data dump** of 2024 service history.
      When it lands: map its customers to `pocomos_id` (name/address/phone match — RealGreen ids
      won't join), backfill 2024 rows into `mosquito_service_counts` (`service_count`,
      `first_service_date`, `last_service_date` — the rev-17 rule needs the dates), mark those rows
      as dump-sourced so the nightly scrape can't prune them (the current prune drops ids outside
      the live cohort), then flip `reliable` for `fromYear === CY-2`. See REFERENCE §5.8 / §9 #8.

## Ready to build (unblocked) — accuracy follow-ups
- [ ] Return-rate full-history source (NOT a 24→25 fix — 2024 is pre-Pocomos, see the RealGreen item
      above). The Pocomos service-history table renders only the most recent ~30 services (~1 season),
      so any from-year older than CY-1 collapses even within the Pocomos era. To widen the window:
      parse the PDF export (/customer/{id}/contract/{cid}/history/download → application/pdf) or find
      a paginated/date-ranged services endpoint. Probe: scripts/probe-history-window.ts.
      See REFERENCE §5.8 / §9 #8.
- [ ] Return-rate coverage gap: 7 customers in the old Returning box have no readable mosquito
      service history (`table_ok=false` — their default rendered contract isn't the mosquito one), so
      rule 1 can't confirm them and they fail closed out of the box/denominator. ~0.4% of the box.
      To fix we'd need to read a NON-default contract's history without switching the customer's
      active contract (READ-ONLY constraint). Low priority; documented in REFERENCE §5.8.

## Worklist / cleanup (not code)
- [ ] Apply a 2026 tag (or confirm cancellation) for the **10 Missing-tag active customers** on
      `/sales` → Missing tags (8 carry a 2025 tag = not renewed; 2 have no prior-year tag at all,
      flagged "no prior tag"). Live roster is on the card (name/id/tags/last service/Profile).

## Done (recent)
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
