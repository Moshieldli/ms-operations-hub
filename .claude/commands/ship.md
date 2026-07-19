---
description: Build + ship a change end-to-end using this repo's ritual (probe → build → docs → commit → push → verify live → report).
argument-hint: <spec — what to build/fix>
---

Ship this: **$ARGUMENTS**

Follow the MS Operations Hub shipping ritual. Work autonomously start to finish — don't ask for
confirmation; make reasonable calls on ambiguity and flag them in the final report. The relevant
skills (`pocomos-scraping`, `dashboard-conventions`) carry the details — load them if the task
touches Pocomos or the dashboard UI.

## 1. Probe first (READ-ONLY)
If the build depends on a Pocomos field/shape/behavior you haven't confirmed, **probe it first**
in the same session, print what you found, then build against the finding. Keep probes READ-ONLY.

**Pocomos is READ-ONLY. Landmines — never do these:**
- No `POST /customer/{id}/contract/{pcid}/service-history/{paid,unpaid}` (async ACTIONS, not feeds).
- No `/customer/{id}/active-contract/{pcid}/update` (contract switcher / mutation).
- **405-on-GET = an ACTION, not a feed that "just needs POST." Stop.**
- The per-contract **PDF export is unreliable** (invoice packet) — the HTML `#services-table` is
  ground truth. No read-only way exists to render a non-default contract.
- DataTables feeds require the **legacy 1.9** body (`scripts/lib/pocomos.ts::legacyDataTablesBody`);
  modern params are silently ignored.

## 2. Build
- **Year-relative** logic always (derive from `CURRENT_YEAR`; never hardcode a year).
- Reuse shared components/libs; follow the report pattern (cron + cache + refresh) and UI idioms
  from the `dashboard-conventions` skill.
- If a page reads a mutable cache, set `fetchCache = "force-no-store"` + `revalidate = 0`.
- Typecheck (`npx tsc --noEmit`) and build (`npm run build`) clean before shipping.

## 3. Docs (source of truth — required, not optional)
- Bump `docs/REFERENCE.md`: prepend a one-line **rev N** note to the header, and update/add the
  relevant §. Keep it accurate to shipped reality.
- Update `docs/BACKLOG.md`: move done items to Done with a one-line note; add new items/decisions.

## 4. Commit + push
- Command hygiene (PowerShell/Windows): single-line `git commit -m "..."`, no `$(...)`, call
  `node`/`git`/`npx vercel` directly. Branch first if on a protected default (this repo pushes to
  `main` directly, which is fine here).

## 5. Deploy + VERIFY LIVE
- GitHub auto-deploy has been unreliable — **run the manual deploy** unless you've confirmed the
  push auto-deployed: `npx vercel --prod --scope moshieldlis-projects --yes`.
- **Verify LIVE with Playwright, NOT curl+regex** (our en-dash / attribute-order / dropdown-
  children-render-on-click history is why): run `scripts/verify-live.ts`, and/or
  `scripts/lib/livecheck.ts <url> [clickText] [expectText...]` for the specific new UI. Assert on
  the RENDERED DOM (click dropdowns/collapsibles first).

## 6. Report (standard format)
- **What shipped** — plain-language summary of the change.
- **Numbers** — old vs new where the change moves a metric; call out the reconciliation.
- **Judgment calls** — anything ambiguous you decided, and why; anything you deliberately left.
- **Verification** — what you checked live and that it passed.
