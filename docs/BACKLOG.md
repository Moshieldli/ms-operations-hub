# Backlog — MS Operations Hub

## Ready to build (unblocked)
- [ ] Cancelled – This Year (by deactivation date) + cancelled-by-reason — needs the per-customer
      deactivation scrape job (date+reason are scrape-only; sales_status scrapeable from
      service-information). See REFERENCE §9 #6.
- [ ] Assigned-only "Next scheduled" + 48h color rescue: per-customer scheduled-services scrape,
      Route Assigned == "Assigned" (exact match), wire into rowToneClass() hook. See REFERENCE §9 #5.

## Needs a human decision
- [ ] "Real lead" definition for close rate — pending Rivka & Leon (drops into isRealLead() hook).

## Worklist / cleanup (not code)
- [ ] 4 customers-with-issues to review: Alex Abraham (1305276), Ariel Roffel (1237341),
      Yuliya Lankri (1164303), Zachariah Robinson (1237274).

## Done (recent)
- [x] 2026-Renewed bucket fix (RETAINED ~991 / AT_RISK ~17)
- [x] Year-relative cancelled taxonomy + Not Renewed (377) + issues list
- [x] Sales relabel/reorg + inline definitions + reconciliation line
- [x] Overdue Profile link + day-based coloring + new-tab links
- [x] Visual polish pass (type scale + semantic color)
- [x] Leads tab scaffold (denominator + per-rep live; numerator pending)
- [x] Leads close-rate numerator + denominator via the Advanced Search two-step feed
      (set search[leadStatus][] for all five statuses, pull /lead/lead-advanced-search/data).
      Conversions live: 76 / 324 = 23.5% YTD; per-rep + unattributed from the one feed.
- [x] CLAUDE.md + REFERENCE.md consolidation
