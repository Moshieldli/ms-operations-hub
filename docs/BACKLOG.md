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
- [ ] Return rate: is the mid-season-cancel denominator canonical? /sales shows BOTH (primary =
      count mid-season cancels; excl mid-season = drop them). Pick one as the headline. Pending
      Rivka & Leon. See REFERENCE §5.8 / §9 open #8.
- [ ] Return rate: is **Active + "NT - Do Not Auto Renew"** (finished the season, declined renewal)
      a CANCELLED customer for return-rate purposes? Pending Rivka & Leon. Related: the audit
      (scripts/audit-return-gap.ts) shows the 25→26 numerator already counts ~128 now-inactive/on-hold
      customers who carry a 2026 continuation tag — deciding this sets whether "real {year}" should
      require currently-active/serviced. See REFERENCE §5.8 / §9 open #8.

## Worklist / cleanup (not code)
- [ ] 4 customers-with-issues to review: Alex Abraham (1305276), Ariel Roffel (1237341),
      Yuliya Lankri (1164303), Zachariah Robinson (1237274).

## Done (recent)
- [x] /sales return-rate card (live: 24→25 73.4%, 25→26 74.0%) — real mosquito customers (mosquito-family
      contract carrying that season's tag, Event-Spray-only excluded) who returned next season;
      primary + excl-mid-season denominators; computed in getSalesTaxonomy(); compact on /tv/sales.
      See §5.8. (Denominator choice → Needs a human decision above.)
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
