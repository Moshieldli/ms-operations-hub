---
name: pocomos-scraping
description: >-
  How to read data from Pocomos (the pest-control CRM) safely and correctly.
  Use whenever a task touches Pocomos — scraping customers/leads/services,
  building a DataTables feed, adding a probe, converting a short/web id, or
  anywhere the READ-ONLY rule and its landmines apply. Covers the two web
  surfaces + JWT API, session handling, the legacy DataTables 1.9 body, the
  Symfony-report form pattern, id conversion, and the mutation landmines that
  have bitten this project.
---

# Pocomos scraping

**READ-ONLY against Pocomos, always.** GET + DataTables-read POST only. Never mutate a
record, never switch a customer's active contract. If a task needs a write, stop and ask.

## Surfaces

- **Surface A — JWT API** (`/jwt/...`): `src/lib/pocomos/client.ts` (`getJson`, `pocomosOffice`).
  Auth: mint token via `auth.ts` (XauthToken header, token at `response.response`), 5-concurrent
  cap. Customer list `/jwt/pronexis/customer/list/{office}` returns only
  `{id, firstName, lastName, phone, emailAddress, postalCode, status, lastServiceDate, nextServiceDate}`
  — **no short id, no address**. Per-contract tags: `/jwt/office/{o}/contract/{pestContractId}/tags`.
- **Surface B — web back-door** (`src/lib/pocomos/webSession.ts`): PHPSESSID login, then
  `getSessionedHtml(path)` / `postSessioned(path, body)`. This is where the DataTables `/*-data`
  feeds and the Symfony reports live.
- **Surface C — per-customer scrape**: `getSessionedHtml('/customer/{id}/service-history')` etc.
  Renders the customer's **default contract only** — never switch it.

Script helpers: `scripts/lib/pocomos.ts` re-exports the session layer and provides
`legacyDataTablesBody()` + `LEADS_DATA_COLUMNS`.

## DataTables feeds — MUST be legacy 1.9

Every `/*-data` endpoint (`/leads/data`, `/customers/data`, `/lead/lead-advanced-search/data`,
`/all-notes-data`, …) requires **legacy DataTables 1.9** request params. Modern 1.10+ params
(`draw`, `start`, `length`, `columns[]`, `order[]`, `search[value]`) are **silently ignored** —
you get 200 + a wrong-ordered default view, not an error. The `mDataProp_N` entries are
load-bearing (the endpoint resolves `iSortCol_0` to a field name through them).

Use `legacyDataTablesBody(columns, {start, length, sortColumn, sortDir, sort})` from
`scripts/lib/pocomos.ts` — don't hand-roll it. Canonical in-app body: `leadSync.ts::fetchLeadsPage`.

**Symptom of getting it wrong:** mixed-year rows in a page that looks sorted-by-date.

## Symfony-report form pattern (completed-jobs, unpaid-invoices, all-notes)

These are forms that POST to a data endpoint with a CSRF token:
1. `GET` the form page (e.g. `/completed-jobs-report`), scrape the `_token`
   (`name="{form}[_token]" value="..."`).
2. `POST` the data endpoint with the filter fields (`{form}[office][]`, `[startDate]`/`[endDate]`
   in **MM/DD/YY** or MM/DD/YYYY, `[customerStatus][]`, `[_token]`) — often combined with the
   DataTables params in the same body.
   - `/completed-jobs-report` → `#results-table`, one POST returns the whole year.
   - `/all-notes-data` → **customer notes ONLY** (no lead notes; lead notes need per-lead
     `/lead/{id}/lead-information` `#notes-table`).

## ID conversion (short 6-digit ↔ web 7-digit)

Pocomos exposes the **short id on NO readable surface**. Bulk exports key on the 6-digit short id;
everything else keys on the 7-digit web id. Build the map by matching contact details
(email → phone → name → lastname+zip) — see `src/lib/service/idMap.ts` / `customer_id_map`.
Duplicate web records (one human, ≥2 records) are expected — Pocomos spawns a new record on lead
conversion. Cluster by name identity, not email alone (fathers/daughters share inboxes).

## ⚠ LANDMINES — endpoints that look like feeds but are ACTIONS

- `POST /customer/{id}/contract/{pestContractId}/service-history/paid` (and `/unpaid`) —
  **async ACTIONS**, not data. GET returns **405**; POST queues a job
  (`{"successful":true,"message":"...processing..."}`). Do NOT POST them.
- `/customer/{id}/active-contract/{pestContractId}/update` — the contract **switcher** (mutation).
- **Rule: 405-on-GET means the endpoint is an ACTION, not a feed that "just needs POST." Stop.**
- The per-contract **PDF export** (`/customer/{id}/contract/{pcid}/history/download`) is an
  **invoice packet, NOT service data** — ops ruling "never accurate"; it mismatched the HTML
  table 4 of 5 times. The HTML `#services-table` is ground truth (but renders only ~1 recent
  season and only the default contract).
- There is **no read-only way to render a non-default contract's history** — query params are
  ignored, the URL variants 404, and the page has no contract picker.

## Two traps that silently produce wrong-but-200 results

1. Legacy-vs-modern DataTables body (above).
2. `/leads/data` saved-view is **per-user server-side and sticky** through fresh logins — the
   `mstli.apiuser` view stays scoped regardless of UI clears.

Probe first when a build depends on a field/shape you haven't confirmed. Keep probes READ-ONLY.
