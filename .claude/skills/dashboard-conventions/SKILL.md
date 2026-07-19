---
name: dashboard-conventions
description: >-
  UI + data-flow conventions for the MS Operations Hub dashboard (Next.js 14
  App Router + shadcn/ui + Neon). Use when building or editing a page, card,
  table, stat box, collapsible section, or a nightly-cron + cache-table report.
  Covers the cache/cron/refresh pattern, the shared components (RowTable,
  PausedBalanceCard, CollapsibleSection), stat-box + drill-down idioms, tone
  colors, external-link rules, and year-relative logic.
---

# Dashboard conventions

Stack: Next.js 14 (App Router, `src` dir, `@/*` alias), TypeScript, Tailwind v3, shadcn/ui
(classic v3 — HSL vars, Radix Slot, tailwindcss-animate), Neon Postgres, Vercel Pro.

## The report pattern (cron + cache + refresh)

Every heavy report follows the same shape — **the page never scrapes on load**:

1. **Cache table** in Neon (`initSchema()` in `src/lib/db.ts`, idempotent `ALTER TABLE … ADD
   COLUMN IF NOT EXISTS` for new fields). Truncate-and-reload or upsert.
2. **Domain lib** `src/lib/**/<name>.ts` with `refreshX()` (scrapes → writes cache) and
   `getXReport()` (reads cache, computes view — instant, no Pocomos calls).
3. **Nightly cron** `src/app/api/cron/<name>/route.ts` (`export const maxDuration = 300`;
   auth via `Authorization: Bearer $CRON_SECRET`), registered in `vercel.json` `crons`.
4. **API route** `src/app/api/<area>/<name>/route.ts`: `GET` reads, `POST` = "Refresh now"
   behind a short `sync_state` lock (`getSyncState`/`setSyncState`).
5. **Page** `src/app/<area>/<name>/page.tsx` (`export const dynamic = "force-dynamic"`) reads
   `getXReport()` and passes to a client view. **If the page reads a mutable cache, also set
   `export const fetchCache = "force-no-store"` + `revalidate = 0`** — otherwise Next.js can pin
   an early empty result of the Neon read and serve stale zeros (this bit `/leads/followup`).
6. **Client view** `src/components/<name>-view.tsx` with a "Refresh now" button that POSTs then
   re-GETs. **Manual fill script** `scripts/run-<name>.ts`.

Attribution/derivation is computed **on read** from the raw cache rows, so new questions don't
need a re-scrape (e.g. respray attribution, followup buckets).

## Components (reuse — don't copy)

- `components/service-rows.tsx` → `RowTable` (mosquito status tables) + `PausedBalanceCard`
  (shared by `/service/overdue` and `/finance`). Also exports `fmt`, `money`, `shortDate`.
- `components/ui/collapsible-section.tsx` → `CollapsibleSection` (native `<details>`/`<summary>`,
  chevron rotates via `group-open:rotate-90`, works with keyboard + find-in-page) and
  `MaybeCollapsible` (collapse only when a list is long). Used by /sales anomalies,
  /leads/followup buckets, /service/resprays weekly.
- `components/nav.tsx` → `NavDropdown` (click-driven, closes on outside-click/Escape/navigation,
  works on touch). A tab is active on its page AND children:
  `pathname === href || pathname.startsWith(href + "/")`.

## Idioms

- **Stat boxes / tiles**: count + label + one-line definition; tone color only where it means
  something. Tone palette: neutral (default), `text-emerald-600` healthy, `text-amber-600`
  attention, `text-red-600`/`text-rose-600` action.
- **Bucket UI**: prefer **collapsible per-bucket sections** (header = label + count + chevron)
  over multi-select filter boxes — gives an obvious one-click view of each category.
- **Drill-down**: a table cell with a count expands to detail rows; keep the audit/profile link.
- **External links** open in a new tab: `target="_blank" rel="noopener noreferrer"`. Customer →
  `https://mypocomos.net/customer/{id}/service-information`; lead → `/lead/{id}/message-board`.
- **Self-clearing rosters** (anomalies): recompute membership live each refresh; fixing the
  record in Pocomos drops it off next load — say so on the card.

## Rules

- **Year-relative always**: derive from `CURRENT_YEAR` / `CURRENT_YEAR - 1`. Never hardcode a year.
- **Display-only tasks must not touch** `categorize.ts` / `sales-provider.ts` / `sales-data.ts`.
- Follow the UI tokens in `docs/REFERENCE.md` §6.1 (one type scale; semantic color only).
- After any build: update `docs/REFERENCE.md` (+rev note) and `docs/BACKLOG.md`, then commit,
  push, and **verify LIVE via Playwright** (`scripts/verify-live.ts`) — not curl+regex.
