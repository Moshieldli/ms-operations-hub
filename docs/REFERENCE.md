# MS Operations Hub — Master Reference

**Last updated:** July 7, 2026 (rev 12 — shipped two builds. `/service/overdue`: **scheduled-today rescue** (a row whose next service is today (Eastern) is tinted green, tagged "Today", and dropped from the overdue COUNT with an "Excludes N scheduled for today" sub-line — computed at read time, see §5.5) + **sticky table headers**. `/sales`: **return-rate card** (24→25 = 73.4%, 25→26 = 74.0% live) computed in `getSalesTaxonomy` — real mosquito customers (mosquito-family contract carrying that season's tag, Event-Spray-only excluded) who returned the next season, with a primary and an excl-mid-season denominator (§5.8); compact on `/tv/sales`. Route column for `/service/overdue` **deferred** — no route CODE exists in any Pocomos source (§9 open). rev 11 — full truth-up, doc now matches deployed code as of 2026-07-07. Audited against the live source tree + a live Neon `information_schema` query: added the "Current live state" block; §5 marks the PhoneBurner sync + webhook SHIPPED/LIVE since 2026-05-15 with real file paths + the four live crons; §6 file tree replaced with the actual tree; §7 lists the nine tables that really exist now (adds `leads_close_rate`, real row counts, `webhook_log.pb_contact_id`); §9 resolved items pruned and the lead-data path documented as the working answer (Advanced Search two-step feed — lead *tag-chip* read is the only lead gap left); §12 lead notes corrected. NOTE: requested as "rev 6", but the doc was already at rev 10 — advanced to rev 11 to preserve the rev 6–10 history below rather than regress the number. rev 10 — synced doc to shipped reality: the `/texting` Aerialink archive + the app's only auth gate (§5.7), the hourly roster-reconciliation conversion sweep (§5.5b), the `/leads` close-rate tab (§5.6), and the `texting_messages`/`texting_contacts` tables (§7) are all LIVE. Texting search is now server-authoritative via `?find=` (commit `cdf1b3f`); §6 file tree now lists the texting routes + `middleware.ts`. rev 9 — made `/sales` and `/tv/sales` snapshot-first: they paint instantly from the latest snapshot's `raw_json` (a fast DB read) and revalidate live in the background via a new `GET /api/sales/live` + `useLiveSales()` hook; label flips "as of {date}" → "live · updated just now". `normalizeSummary()` defends against partial/older snapshots; empty-table falls back to a live build. Page-level `AutoRefresh` removed (polling is now client-side). See §3.5 "Load path". rev 8 — rolled the `/sales` contract-type breakdown up into service families in a fixed ops order (Mosquito incl. Event Spray, Tick, Ant, Fly Trap, Spotted Lanternfly, Yellow Jacket, Other). Replaced `summary.contractTypeBreakdown` with `summary.contractTypeGroups` (each family carries `count` + granular `members[]`); card retitled "Service type". Granular contract types still drive the rollup via `contractTypeGroupOf()`. Active Customers / Active Services definitions unchanged. rev 7 — regrouped the `/sales` service breakdown by granular **Contract Type** (`contract.agreement.name`) instead of the broad Service Type (`pest_contract.service_type.name`), which had an "Other" catch-all. Added `NormalizedContract.contractType`; renamed `summary.serviceTypeBreakdown` → `summary.contractTypeBreakdown` and the card to "Contract type" on `/sales` + `/tv/sales`. Active Customers / Active Services definitions unchanged. rev 6 — redefined the `/sales` headline metrics. Active Customers and Active Services are now tag-gated on a current-year tag (`CURRENT_YEAR` in categorize.ts, auto-advancing), not raw `status=Active` counts; added the service breakdown (`summary.contractTypeBreakdown`) rendered on `/sales` and `/tv/sales`; raw pre-gate counts preserved in `summary.debug.activeAllStatuses` / `activeServicesAllStatuses`. See §3.5 "Headline metrics". Buckets logic unchanged. rev 5 — synced doc with shipped reality per commit fe1f12d: marked PhoneBurner sync (cron, age-based folder routing, two-custom-field write) as LIVE rather than planned; replaced the speculative §6 file tree with the files that actually shipped; updated §4 webhook field-name bullets against the real Call End payload; moved webhook field-name reverse-engineering and several integration-quirk items from §9 OPEN to RESOLVED.)
**Project:** MS Analytics — Mosquito Shield of Long Island (Progranic LLC)
**Office ID:** 1512
**Live URL:** https://ms-operations-hub.vercel.app
**GitHub:** github.com/Moshieldli/ms-operations-hub
**Local path:** `C:\Users\OhaviaFeldman\Desktop\ms-operations-hub\`

This document is the single source of truth for how Pocomos and PhoneBurner connect through the MS Operations Hub. Paste it into any new Claude chat or feed it to Claude Code when you need full context.

---

## Current live state

**Deployed:** Next.js 14 (App Router) on Vercel — `https://ms-operations-hub.vercel.app`. Repo `github.com/Moshieldli/ms-operations-hub`, branch `main` (push = deploy). Data in Neon Postgres (`neon-indigo-dog`).

**Shipped pages (live):**
- `/sales` + `/tv/sales` — sales dashboard, snapshot-first with live background revalidation (§3.5, §6.1).
- `/service/overdue` — mosquito overdue-spray report, DB-backed (§5.5).
- `/leads` — lead close-rate tab, v1 raw rate via the Advanced Search two-step feed (§5.6). **LIVE** — not pending.
- `/texting` — Aerialink SMS archive, behind the app's only auth gate (§5.7).
- `/`, `/combined`, `/calling` — index/roll-up/placeholder views.

**Live integrations & crons (`vercel.json`):**
| Cron path | Schedule | Purpose |
|---|---|---|
| `/api/cron/snapshot` | `0 5 * * *` (05:00 daily) | Daily sales snapshot → `snapshots` |
| `/api/phoneburner/sync-leads` | `*/15 * * * *` | Pocomos→PB lead sync (Phase A) + lazy notes refresh (Phase B) — §5.1 |
| `/api/cron/conversion-sweep` | `0 * * * *` (hourly) | PhoneBurner roster-reconciliation active-customer sweep — §5.5b |
| `/api/cron/mosquito-status` | `0 6 * * *` (06:00 daily) | Rebuild `mosquito_service_status` for `/service/overdue` — §5.5 |

Plus the event-driven `POST /api/phoneburner/webhook` (PhoneBurner `api_calldone` → Pocomos note). PhoneBurner sync + webhook have been **SHIPPED/LIVE since 2026-05-15**.

**Neon tables that actually exist** (live `information_schema`, 2026-07-07): `snapshots`, `customers`, `sync_state`, `mosquito_service_status`, `leads_close_rate`, `phoneburner_contacts`, `webhook_log`, `texting_contacts`, `texting_messages`. See §7 for columns + row counts.

**Last major ship:** the `/texting` archive + texting-only auth gate, and the server-authoritative texting search (2026-06-16). PhoneBurner conversion logic last reworked to the hourly roster-reconciliation sweep (2026-06-16).

**Pocomos posture:** READ-ONLY (GET + DataTables-read POST) except the single webhook note-write. Never mutates customer records or switches active contracts.

---

## 1. Big Picture

Three systems, one hub.

```
┌──────────────┐                ┌─────────────────────┐                ┌──────────────────┐
│   POCOMOS    │  ◄──reads──── │  ms-operations-hub  │ ────writes──► │   PHONEBURNER    │
│ (source of   │  ────writes──►│  (Vercel/Next.js)   │ ◄───reads──── │ (dialer for CSRs)│
│   truth)     │                │   + Neon Postgres   │                │                  │
└──────────────┘                └─────────────────────┘                └──────────────────┘
```

**Pocomos** is the system of record. Customers, leads, contracts, tags, notes — everything lives there. The team manages it through `mypocomos.net`.

**MS Operations Hub** is our Vercel app. It pulls from Pocomos via API, stores snapshots and enrichment in Neon Postgres, renders the dashboards (`/sales`, `/tv/sales`), and is the bridge to PhoneBurner.

**PhoneBurner** is a power-dialer. CSRs (Rena and team) work through call lists ("folders") and disposition each call. Our integration auto-feeds new Pocomos leads into the Fresh folder and writes call dispositions back to Pocomos as account notes.

---

## 2. Pocomos vs. PhoneBurner — Customers vs. Leads

This trips everyone up. Read it twice.

### Inside Pocomos

| Record type | What it is | URL pattern | Status field examples |
|---|---|---|---|
| **Lead** | A prospect who never signed up. May or may not have a phone/address. | `/lead/{lead_id}/lead-information` | `Lead`, `Not Home`, `Not Interested`, `Monitor`, `Do Not Knock` |
| **Customer** | Someone who signed an agreement (active or cancelled). | `/customer/{url_id}/service-information` | `Active`, `Inactive`, `On-Hold`, `Pending` |

**Critical:** Leads and customers live in **separate modules** with separate IDs and separate API endpoints. A lead does NOT become a customer record by editing — when a lead converts, Pocomos creates a new customer record and links it.

**Also critical — two IDs for customers:**
- `external_account_id` = the **Customer ID** you see in the UI (e.g., `154427`)
- `id` = the **internal URL ID** used in API paths (e.g., `1161618`)

You must convert between them via:
```
GET https://mypocomos.net/customer/find-customer-by-office?suggest={CUSTOMER_ID}&active=1
→ { results: [{ id: "1161618", external_account_id: "154427", status: "Inactive", name: "..." }] }
```

### Inside PhoneBurner

PhoneBurner has no lead/customer distinction — everything is a **contact** in a **folder** (a.k.a. "category"). We use the folder to encode what kind of contact it is.

| Folder ID | Name | What lives here |
|---|---|---|
| `66223880` | **Leads — Fresh** | New leads from Pocomos lead module, auto-pushed by cron |
| `66223881` | **Leads — General** | Bulk-imported existing leads (one-time historical load) |
| `66223882` | **Leads — Competitor** | Leads tagged `L - Competitor` (deferred to v2 — see §9) |
| `66223883` | **Leads — Financial** | Leads tagged `L - Financial` (deferred to v2 — see §9) |
| `66223884` | **Canc - Competitor Win-Back** | Former customers, cancelled for competitor |
| `66223885` | **Canc - Financial / Price** | Former customers, cancelled over price |
| `66223886` | **Canc - Results Issues** | Former customers, cancelled over service results |
| `66223887` | **Canc - Could Not Reach** | Former customers we couldn't reach |
| `66223888` | **Canc - Personal / Other** | Former customers, other reasons |
| `66233602` | **Active Customer** | Written by conversion cleanup when a lead/cancelled contact converts back to active |
| `66223503` | Follow Up | Exists, not used by sync |
| `47718` | Contacts (default catch-all) | PhoneBurner's root "all contacts" view. NOT a target folder — contacts land here when `category_id` is invalid (which is exactly what happened during the rev-3 incident). |

**How folder IDs are obtained:** call `GET /folders` (NOT `/contacts/categories` — that path 404s despite earlier docs claiming it). The response is `{ folders: { "0": { folder_id, folder_name, ... }, "1": {...}, ... } }`.

**Do NOT use the dialer URL `view_id=N` numbers.** Earlier revs of this doc claimed the base64-decoded `view_id=3275950` URL fragment was the folder ID — that was wrong. Those values are dialer view session IDs, not folder IDs. Sync runs that used them silently landed contacts in folder 47718 (the catch-all) with most fields stripped, because PhoneBurner accepted the POST but ignored the unrecognized `category_id`. See the rev-4 incident in this doc's history.

**How we link back to Pocomos from a PhoneBurner contact:**
- `custom_fields: [{ name: "Customer ID", type: 1, value: lead_id_or_customer_id }]` — stores the Pocomos ID
- `website: https://mypocomos.net/lead/{lead_id}/lead-information` (for leads) — one-click jump to the record

**Excluded from sync (v2 — once a lead-tag read path is found):** Leads tagged `NT - No Marketing` or `L - DNC` (Do Not Call). In v1 nothing is excluded by tag because we have no lead-tag read endpoint; the `marketing_type_name` field on `/leads/data` may be a workable substitute and is being investigated.

---

## 3. Pocomos API

### Base URL
```
https://mypocomos.net
```

### Authentication

**This is the #1 thing people get wrong. The auth header is `XauthToken`, NOT `Authorization: Bearer` and NOT `Authorization: JWT`.**

**Step 1 — get a JWT token:**
```http
POST /public/technician/jwt_token
Content-Type: application/x-www-form-urlencoded

username=mstli.apiuser&password=mstli.apiuser
```

**Response shape:**
```json
{ "response": "eyJ0eXAiOiJKV1QiLCJh..." }
```
The token is at `body.response`, **not** `body.token` or `body.jwt`.

**Step 2 — use it on every subsequent request:**
```http
GET /jwt/pronexis/customer/list/1512
XauthToken: eyJ0eXAiOiJKV1QiLCJh...
```

**Token lifetime:** ~50 min cache is safe. Refresh proactively before expiry.

**Auth credentials in use:**
- API user: `mstli.apiuser` / password `mstli.apiuser`
- Created by David Tribe at Pocomos support
- Technician role, Secretary permissions

### Path conventions

- **Auth endpoint:** `/public/technician/jwt_token` (the only `/public/` path)
- **Data endpoints:** all under `/jwt/...`
- Two sub-conventions exist: `/jwt/pronexis/...` for customers/contracts, and `/jwt/{office}/...` for leads and the tags endpoint. Always copy the exact path from Postman; don't try to guess.
- Paths under `/api/v1/...` return 404. Don't try them.

### Customer endpoints

```http
GET /jwt/pronexis/customer/list/1512
→ Returns ALL customers across the entire Pocomos system (~3,730), not just office 1512.
  Filter client-side on status === 'Active' / 'Inactive' / 'On-Hold' / 'Pending'.

GET /jwt/pronexis/1512/customer/{customerId}/contracts
→ Returns contracts for one customer. Contract keys: id, active, date_created,
  profile, billing_frequency, agreement, status, pest_contract, sales_status.
  pest_contract is nested and contains service_type and service_frequency.
  NO tags field here — tags live on a separate endpoint (see below).

GET /customer/find-customer-by-office?suggest={CUSTOMER_ID}&active=1
→ Resolves Customer ID → URL ID. Use before writing notes.
  Returns { results: [{ id, external_account_id, status, name }] }

POST /jwt/pronexis/1512/customer/{url_id}/note/create
Body: { "note": "text", "subject": "PhoneBurner Call" }
→ Writes an account note to a customer. Use url_id (1161618), NOT Customer ID.
```

### Lead endpoints

```http
GET /jwt/1512/lead/list?limit=50&offset=0
→ Paginated list. Max 50/page in docs but 200/page tested working.
  Filter client-side to status.value === 'Lead' (exclude Not Home, Not Interested,
  Monitor, Do Not Knock).
  
  Known fields in list response: id, company_name, first_name, last_name,
  status.value, reason, contact_address.{street, suite, city, postal_code,
  latitude, longitude, region.{id, name, code}}, quote.found_by_type
  
  ⚠️ Phone, email, and date-added are NOT in the list response. Detail call required.

GET /jwt/1512/lead/{lead_id}
→ Single lead detail. As of May 14 we have NOT confirmed phone/date fields here.
  Probe required before relying on it.

POST /jwt/pronexis/customer/save-lead/1512
Body: {
  firstName, lastName, companyName,
  contactAddress: { street, city, region, postalCode, phone },
  emailAddress, accountType: "Residential", billingAddressSame: "1",
  status: "Lead",
  quote: { salesperson, foundByType },
  note: { summary },     // becomes job note after conversion
  notes: { summary }     // account note visible on lead now
}
→ Create a new lead. Confirms what the lead module can hold: phone, email,
  marketing source (foundByType), notes.

POST /jwt/1512/lead/{lead_id}
Body: same shape as save-lead
→ Update an existing lead.

POST /jwt/1512/lead/{lead_id}/note
→ Write a note to a lead. PATH NEEDS VERIFICATION via probe.
```

### Tags endpoint (added by Pocomos in early May 2026)

```http
GET /jwt/office/1512/contract/{pestContractId}/tags
XauthToken: {JWT}

→ Returns tags for a contract. Works in production — this is how the Neon
  customers table is populated with an avg 3.75 tags per customer.

⚠️ The ?lead_id= query param does NOT work. Probe on 5/14 returned 400
  "Unable to locate Contract" for every variant tried:
  - contract/0/tags?lead_id=X       → 400
  - contract/-/tags?lead_id=X       → 500
  - contract/{leadId}/tags?lead_id=X → 400
  - /lead/{leadId}/tags             → 404
  - /jwt/{office}/lead/{leadId}/tags → 404

There is currently NO known endpoint to read lead tags via API. Open gap.
```

This endpoint is the unlock for CUSTOMER tags — before it existed, all tag data required CSV export. Lead tags are still in that pre-API state.

---

## 3.5 Pocomos has three API surfaces

Pocomos is not one API — it's three layered systems, and any non-trivial integration ends up using all three because none of them is complete on its own. They differ in auth scheme, payload shape, and which fields they expose.

### Surface A — JWT API (the "official" one)

- **Auth:** `XauthToken: {jwt}` header. JWT obtained from `POST /public/technician/jwt_token`.
- **Paths:** `/jwt/pronexis/...` (customers, contracts) and `/jwt/{office}/...` (leads, tags).
- **Returns JSON.**
- **Strengths:** stable, documented, what Pocomos support points you to.
- **Weaknesses:** the lead endpoints are shallow — `GET /jwt/{office}/lead/list` and `GET /jwt/{office}/lead/{id}` both omit `phone`, `email`, `date_added`, and the marketing source. Tag-read by lead is not exposed.
- **Use it for:** customer reads, customer note writes (`/jwt/pronexis/{office}/customer/{url_id}/note/create`), tags-by-contract, lead writes, the salesperson/agreement reference data.

### Surface B — Web UI back-door (DataTables endpoints)

- **Auth:** `Cookie: PHPSESSID=…` from a real web login. The same `mstli.apiuser` credentials that authenticate the JWT API also work against `POST /login_submit` — confirmed in this session.
- **Paths:** `POST /leads/data` and `POST /customers/data`. These are the AJAX endpoints the web UI itself uses to populate its tables.
- **Returns JSON** in legacy DataTables 1.9 shape (`aaData`, `iTotalRecords`, `iTotalDisplayRecords`, `sEcho`).
- **Strengths:** returns the rich fields the JWT API hides — phone, email, `date_added`, `marketing_type_name`, status — exactly the fields needed for outbound dialer feeding.
- **Weaknesses:** session-based, expires (~30 min idle), can return `{"type":"redirect","redirect":"/login"}` on expiry, requires Symfony CSRF dance to authenticate, schema is whatever the table happens to render today.
- **Use it for:** the lead sync. This is the only known way to read lead phone/email via Pocomos.

### Surface C — HTML scrape

- **Auth:** same PHPSESSID cookie as Surface B.
- **Paths:** the customer/lead detail pages (`/lead/{id}/lead-information`, `/customer/{url_id}/customer-information`, etc.).
- **Returns HTML.**
- **Use it for:** anything that's neither in the JWT API nor in the DataTables JSON — currently a candidate for reading the Pocomos-side note history of a lead/customer (the `notes.ts` library probes for a JSON endpoint first and falls back to scraping).

### The web-login flow (Surface B/C session bootstrap)

Since the lead sync depends on Surface B, this flow has to work from a serverless function. Confirmed sequence:

1. **`GET /login`** — capture `PHPSESSID` from the response `Set-Cookie` and parse the `value="…"` of the `<input name="form[_token]">` hidden field from the HTML body. This is the Symfony CSRF token; it is per-session and must be sent back on the submit.
2. **`POST /login_submit`** with:
   - `Content-Type: application/x-www-form-urlencoded`
   - `Cookie: PHPSESSID=…`
   - `Origin: https://mypocomos.net`
   - `Referer: https://mypocomos.net/login`
   - body: `form[username]=mstli.apiuser&form[password]=mstli.apiuser&form[_token]={token}`
3. On success: `302 → /` then `302 → /message-board`. The `PHPSESSID` is rotated by the login (different value than step 1) — the rotated cookie is the authenticated one.
4. **Session expiry:** any subsequent `/leads/data` or `/customers/data` call may return `{"type":"redirect","redirect":"/login"}` instead of DataTables JSON. Treat that as "session dead, re-login."

**Do not send** the following — Symfony rejects the form with `"This form should not contain extra fields"`:
- `_csrf_token` (the form uses `form[_token]`, not `_csrf_token`)
- `form[email]` (the form has no email field — `form[username]` is the only identifier)
- `form[rememberMe]` (not in the form schema in the version we're hitting)

The probe at `scripts/probe-pocomos-web-login.ts` walks this end-to-end and was the source of the above.

### Surface B — `POST /customers/data` column map (bulk "Last Service" source)

The `/customers/data` DataTables endpoint is the **bulk source of last-service date** for the `/service/overdue` report (the JWT contract object has no usable last-service date — confirmed, see §9). Same legacy DataTables 1.9 request body as `/leads/data` (`sEcho`, `iDisplayStart`, `iDisplayLength`, `iColumns`/`sColumns`, `mDataProp_N`). `iTotalRecords` ≈ 1,127; **~6 pages at 200/page covers the whole office.**

Rows come back as **positional arrays** keyed `"0".."10"` (the server returns columns by index and ignores the `mDataProp` field names) **plus** appended named keys `id, is_parent, is_child, multiple_contracts, commercial_account`. Column map (read from the `/customers/` `<thead>` — note the **trailing slash**; `/customers` 301-redirects):

| idx | header | idx | header |
|---|---|---|---|
| 0 | (select) | 6 | Status |
| 1 | First Name | 7 | Sign up date |
| 2 | Last Name | **8** | **Last Service** (MM/DD/YY) |
| 3 | Phone | 9 | Next Service |
| 4 | Email | 10 | (actions) |
| 5 | Zip | | |

**Column 8 "Last Service" is per-CUSTOMER and is the last service of ANY type** (Regular/Initial/Respray), not per-contract. It is authoritative for mosquito-only customers; for customers who also hold an active non-mosquito (add-on) contract it may reflect the add-on, so those are scraped per-page instead. `multiple_contracts` (0 vs >0) is a quick add-on flag. **Column 7 "Sign up date"** (MM/DD/YY) is also pulled by the fetcher — it drives the sign-up column shown on every overdue row and the "brand-new signup" exclusion (see §5.5). Canonical fetcher: `src/lib/service/customersData.ts`. Probes: `scripts/probe-bulk-spray-date.ts`, `probe-customers-headers.ts`, `probe-bulk-coverage.ts`, `probe-balance-signup.ts`.

> **This grid has NO "Balance" column.** Confirmed live 2026-06-12 (`scripts/probe-balance-signup.ts`): this office's `/customers/data` view is configured with exactly 11 columns (0–10, as above); requesting columns 11+ returns empty cells, and the DataTables `aoColumns` def has 11 entries. Open balance for `/service/overdue` therefore comes from the **Unpaid Invoices report**, not this grid — see §3.6. (Bonus: the grid also lacks a "Last Regular Service Date" column; only "Last Service" / any-type is available here. A regular-only date would require the per-page service-history scrape.)

### Surface B — `POST /finance/unpaid-data` (bulk open-balance source)

The **Unpaid Invoices** report is the bulk source of **open balance** for `/service/overdue` (Balance is not a column in this office's `/customers/data` grid — see above). It is a Symfony *search form*, not a JSON DataTables grid:

1. `GET /finance/unpaid` and scrape the CSRF token from `<input name="unpaid_search_terms[_token]" value="…">`.
2. `POST /finance/unpaid-data` (form-urlencoded, `X-Requested-With: XMLHttpRequest`, referer `/finance/unpaid`) with:
   - `unpaid_search_terms[_token]` = the scraped token
   - `unpaid_search_terms[branches][]` = office id (`1512`)
   - `unpaid_search_terms[includeMiscInvoices]` = `1` (the season prepay installments are "Misc. Invoice"s)
   - `unpaid_search_terms[lessThan30|thirtyTo60|sixtyTo90|moreThan90]` = `1` (all four aging buckets)
   - `unpaid_search_terms[status]` = `Unpaid` ← **required**; without it the server 500s / returns an empty shell
   - `unpaid_search_terms[reminderSearchTermsType][searchTermsType][dates][dateStart|dateEnd]` = a **wide** MM/DD/YYYY window (we use 3 years back → next year-end)

**Gotchas (all confirmed live 2026-06-12):**
- An **empty** POST body returns a report, but it silently clamps the Due date to the **last 30 days** and drops older past-due invoices. You must pass the token + wide dates to get the true full set.
- A **partial** body (some fields, no token) is CSRF-rejected → 302/empty.
- Do **not** set `acctOnFile=1` — it filters to accounts with a card on file and under-counts.
- The response is an **HTML report** (`#main-table`) with **one row per invoice**, not per customer. Each row carries a `/customer/{id}/…` link and a per-invoice balance in `<span class="balance">N.NN</span>`. A customer's open balance = the **sum** of their invoice balances.

A search POST only READS — it never mutates a record. Canonical fetcher: `src/lib/service/openBalance.ts`. Probe: `scripts/probe-unpaid-form.ts`.

### Tag values used in routing/categorization

| Tag | Meaning | Used for |
|---|---|---|
| `2026 - New Sale` | Customer signed in 2026 | NEW / RETURNING bucket |
| `2026 - Auto` | Auto-renewed | RETAINED — Auto |
| `2026 - SEB` | Service Email Booking | RETAINED — SEB |
| `2026 - EB` | Email Booking | RETAINED — EB |
| `2026 - Renewed` | Renewed continuation (dominant 2026 continuation tag) | RETAINED — Renewed |
| `2025 - New Sale`, `2024 - ...` etc. | Historical year tags | Distinguish RETURNING vs. NEW |
| `L - Competitor` | Lead competing with another company | PhoneBurner folder 66223882 |
| `L - Financial` | Lead has price/financial concerns | PhoneBurner folder 66223883 |
| `L - DNC` | Do not call | Exclude from PhoneBurner sync |
| `NT - No Marketing` | Don't market to this lead | Exclude from PhoneBurner sync |

**Bucket logic (current implementation):**
- **NEW** = has `2026 - New Sale` AND has no prior YYYY tag
- **RETURNING** = has `2026 - New Sale` AND has any prior YYYY tag
- **RETAINED — Auto / SEB / EB / Renewed** = has a matching `2026 - {Auto|SEB|EB|Prepaid|Committed|Renewed}` continuation tag (no `New Sale`)
- **AT_RISK** = active customer with a prior-year tag but no current-year continuation/new-sale tag
- **CANCELLED** = status `Inactive`
- **`2026 - Renewed` IS a live continuation tag (corrected 2026-06-15).** Probe A found 148 active customers carry it and 125 had it as their only current-year tag — those were wrongly dropping into AT_RISK ("Current Cancelled"). It is now folded into the RETAINED continuation set in `categorize.ts` (`bucketFor`) and tallied as a 4th RETAINED subtype (`retainedSubtypes.renewed`) alongside Auto/SEB/EB. After the fix: RETAINED ≈ 985, AT_RISK ≈ 17. Earlier docs/comments claiming the tag "does not exist" were wrong.

**Sales-page display labels + layout (relabeled/reorganized 2026-06-15, display-only — internal bucket keys and `categorize.ts` logic unchanged):**
- Label map: NEW→"New", RETURNING→"New – Season Skipped" (was "New – Lapsed"), RETAINED→"Returning", AT_RISK→"Not Renewed" (was "Current Cancelled"), CANCELLED→"Cancelled – All Time".
- Tiles are arranged in two rows: **Row 1 (this season)** = Active Customers · Active Services · New · New – Season Skipped · Returning · Not Renewed; **Row 2** = Cancelled – All Time · Untagged.
- Every tile is **self-describing**: the criteria/definition text is rendered inline inside each square (the old separate "How are buckets calculated?" card was removed).
- A **reconciliation line** under Row 1 computes live: `<New+Skipped+Returning> tagged + <NotRenewed> not renewed = <sum> vs <Active> active (Δ<n> edge cases)`.
- `/tv/sales` carries the same relabels + the Renewed subtype, but stays a glanceable grid (no inline definitions / reconciliation line — a deliberate choice for the TV view).

**Year-relative cancelled taxonomy + "Customers with issues" (2026-06-16).** "Not Renewed", "Cancelled – All Time", and the issues roster are now computed **year-relative** from `CURRENT_YEAR` and `PRIOR_YEAR` (= `CURRENT_YEAR - 1`) — never hardcoded — in `src/lib/sales-taxonomy.ts` (`getSalesTaxonomy()`), surfaced via `GET /api/sales/taxonomy` and fetched client-side by `sales-view.tsx`/`tv-sales-view.tsx` (decoupled from the snapshot paint via `useSalesTaxonomy`). This REPLACES the old "Not Renewed = AT_RISK (active, prior-year tag, no current-year)" display.
- **Not Renewed** = customers of ANY status with a `{PRIOR_YEAR} -` tag but NO `{CURRENT_YEAR} -` tag — last season's customers who haven't signed up this season (mostly Inactive). Its own card; description: *"Had a {prior} tag, no {year} tag — last season's customers who haven't renewed yet."* Sub-hint splits still-active vs inactive.
- **Cancelled – All Time** = currently-Inactive customers NOT in the Not-Renewed group. Headline = live Inactive total (`dataset.diagnostics.inactiveCount`) minus the Not-Renewed inactive carve-out; relative year sub-breakdown (this year / last year / earlier / undated) by last-service date, with `undated` absorbing not-yet-enriched rows so it sums to the headline.
- **Customers with issues** = currently-Active customers with NO `{CURRENT_YEAR} -` tag AND NO `{PRIOR_YEAR} -` tag — the edge cases that fit no bucket. Rendered as a table (name, id, full tag list, **Profile** link → `service-information`, opens in a new tab). Replaces the old "Untagged" tile.
- **Data sources:** active per-customer tags from the live `getDataset()` (10-min cached); non-active tags from the enriched `customers` Neon table (overnight enrichment). A customer that re-activated is counted on the active side only (dedup by id).
- The reconciliation line is now `{tagged active} tagged active + {off-bucket} off-bucket (not-renewed / issues) = {activeAllStatuses} active customers` (synchronous, from `summary.debug.activeAllStatuses`).
- **New-tab links:** the issues "Profile" link and the `/service/overdue` "Profile"/"History" links open with `target="_blank" rel="noopener noreferrer"`.

**Headline metrics — Active Customers & Active Services (redefined 2026):**

The two big numbers on `/sales` (and `/tv/sales`) are **tag-gated**, not raw status counts. The gate is the current year, derived from `CURRENT_YEAR` in `categorize.ts` (`new Date().getFullYear()`), so it auto-advances each January with no code change.

- **Active Customers** = customers with status `Active` **AND** at least one unioned tag whose trimmed text starts with `"{CURRENT_YEAR} -"` (e.g. `2026 - Auto`, `2026 - EB`, `2026 - New Sale`, `2026 - SEB`). This intentionally excludes AT_RISK actives (prior-year tags only) and untagged actives — they're `Active` in Pocomos but have no current-year commitment.
- **Active Services** = for each customer that qualifies as an Active Customer above, every contract whose own `status === "active"`. The gate is applied at the **customer** level: a qualifying customer's active contracts ALL count, even if an individual contract carries no current-year tag.
- **Service type** (`summary.contractTypeGroups`) = those same Active Services rolled up into service families and shown in a fixed, ops-requested order: **Mosquito** (incl. Event Spray) → **Tick** → **Ant** → **Fly Trap** → **Spotted Lanternfly** → **Yellow Jacket** → **Other**. Each family is derived by `contractTypeGroupOf()` from the granular `NormalizedContract.contractType` (`contract.agreement.name` — the Pocomos "Contract Type" pick-list, e.g. `Mosquito Control`, `Natural Mosquito Control`, `Add On Tick Control`, `Spotted Lanternfly (3)`, `Yellow Jacket Trap`). Each group carries `count` plus `members[]` (the granular contract types under it, sorted desc). Group counts (and all members) sum to `totals.activeServices`. Rendered as a "Service type" card on `/sales` (family total with a muted granular sub-line) and a compact grid on `/tv/sales` (family totals only). **Classifier note:** "lantern" is matched before "ant" (since "lantern" contains "ant"), and "fly trap" is matched as a phrase so it doesn't collide with "Spotted Lanternfly". **Source note:** this is deliberately NOT `pest_contract.service_type.name` — that broad 11-category Service Type has its own `Other` catch-all and is too coarse; `NormalizedContract.serviceType` still carries the broad value for any other use.
- **Reconciliation counts** — the pre-gate raw numbers are preserved in `summary.debug.activeAllStatuses` (all status=`Active` customers) and `summary.debug.activeServicesAllStatuses` (active contracts across all active customers). They are NOT shown as headline figures; they exist so the tag-gated drop can be reconciled against a raw Pocomos status count.
- **Snapshots** — `snapshots.active_count` / `services_count` store the tag-gated headline numbers going forward; the raw counts and the service-type breakdown ride along inside `raw_json` (whole `SalesSummary`), so no schema migration was needed.

The buckets section (New / Returning / Retained / At-Risk / Cancelled) is unchanged by this redefinition — it still categorizes every active-status customer by year tags as described above.

**Load path — snapshot-first with background live revalidation (added 2026-05-28):**

`/sales` and `/tv/sales` used to rebuild the whole dataset live from Pocomos (thousands of sequential calls, ~55s) on every cold serverless start. They now paint instantly from the latest nightly snapshot, then refresh live in the background:

1. **Server (instant paint).** The page server component calls `loadInitialSales()` (`src/lib/sales-data.ts`), which reads the most recent snapshot via `listSnapshots(1)` and parses its `raw_json` into a `SalesSummary` through `normalizeSummary()`. This is a single fast DB read — no Pocomos calls — so the page paints in well under a second, labelled **"as of {snapshot_date}"** with an amber dot.
2. **Defensive normalization.** `normalizeSummary()` defaults every field, so an older snapshot missing newer keys (e.g. `contractTypeGroups`) renders what's present and never throws; the missing pieces are filled by the live fetch. Each group's `members[]` is defaulted too.
3. **Client (background live).** A client component (`SalesView` / `TvSalesView`) drives the `useLiveSales()` hook (`src/components/use-live-sales.ts`): after paint it fetches `GET /api/sales/live`, swaps the fresh numbers in, and flips the label to **"live · updated just now"** with a pulsing emerald dot. A subtle **"refreshing live…"** indicator shows while a fetch is in flight. It re-polls every 5 minutes (the old `AutoRefresh` cadence, now client-side — the page-level `AutoRefresh` component was removed).
4. **Live endpoint.** `GET /api/sales/live` (`src/app/api/sales/live/route.ts`) just returns `getSalesSummary()` — the existing live build with its 10-min in-memory cache, unchanged. A cold call still does the full Pocomos fetch (~55s); warm instances answer from cache.
5. **Empty-table fallback.** If there is no snapshot row yet (or the DB read fails), `loadInitialSales()` builds live exactly as before and the page renders with `source: "live"` from the first paint.

### Pocomos rate limits & quirks

- JWT cache: 50 min
- Parallel batches: 20 concurrent max, 300ms pause between batches (proven in Apps Script work)
- Customer list returns everything system-wide, not just your office — filter client-side
- Contract API does NOT include tags inline; must call the tags endpoint per contract/lead
- The `/jwt/pronexis/tags/list/1512` endpoint returns the **tag catalog** (definitions), not customer-tag assignments — don't confuse the two

---

## 4. PhoneBurner API

### Base URL
```
https://www.phoneburner.com/rest/1/
```

### Authentication

```http
Authorization: Bearer exRZkIeTSL7wY0Q1MimzJRLmB3JWgvaatMmGhW6K
```

Token lives in env var `PHONEBURNER_TOKEN`.

### Contact endpoints

**CRITICAL: PhoneBurner's POST/PUT to `/contacts` requires `application/x-www-form-urlencoded`. JSON bodies are silently partial — `first_name` / `last_name` may stick, but `phone`, `email`, `notes`, `custom_fields`, `category_id` are all dropped.** Discovered the hard way during the rev-4 cleanup; see commit history.

**Field name corrections (request body, form-encoded):**

| What you'd guess | What PB actually wants |
|---|---|
| `raw_phone` | **`phone`** (10-digit string; PB stores it as `raw_phone` in the GET response — inconsistent on purpose) |
| `email_address` | **`email`** (PB stores it at `primary_email.email_address` in GET) |
| `notes` | `notes` ✓ (PB prepends `-- DATE @ TIME by USER -- ` automatically) |
| `address1`, `city`, `state`, `zip` | same ✓ |
| `category_id` | `category_id` ✓ (also accepts `folder_id`) |
| `custom_fields: [{name,value,type}]` | **PHP-array form syntax**: `custom_fields[0][name]=Customer ID&custom_fields[0][value]=12345&custom_fields[0][type]=1` |

```http
POST /contacts
Content-Type: application/x-www-form-urlencoded

first_name=John&last_name=Doe&phone=5551234567&email=j@example.com
&address1=100+Main+St&city=Queens&state=NY&zip=11691
&category_id=66223880
&notes=Optional+text+(PB+prepends+timestamp)
&custom_fields[0][name]=Customer+ID&custom_fields[0][value]=154427&custom_fields[0][type]=1

→ Returns 201 with body `{contacts: {contacts: { user_id, first_name, last_name, ... } } }`
  Note: `contacts.contacts` is a SINGLE OBJECT on POST.

GET /contacts/{user_id}
→ Single-contact detail. Returns body `{contacts: {contacts: [ { ... } ] } }`
  Note: `contacts.contacts` is a SINGLE-ELEMENT ARRAY on GET (different shape from POST).
  Useful fields:
    user_id, first_name, last_name, raw_phone, date_added, owner_id
    primary_email.email_address
    primary_address.{address, city, state, zip}
    category.{category_id, name}
    notes.notes (full PB-prepended history string, newline-separated entries)
    custom_fields: [{custom_field_id, name, type, value}]
    primary_phone.{phone, raw_phone, type}

GET /contacts?category_id={N}&page=1&page_size=200
→ List contacts whose category.category_id equals N. THIS is the filter.
  Response: { contacts: { contacts: [...], total_results: N, total_pages: M, page: 1 } }

  **CRITICAL: do NOT use `?folder_id=N` for filtering — PB silently
  ignores it and returns every contact in the entire account.** Proved
  by probing five different folder ids, all returning the same 4,959
  total. (The folder list endpoint refers to folders as `folder_id`,
  but the contact list endpoint filters on `category_id`. PB's inconsistency.)

PUT /contacts/{user_id}
Content-Type: application/x-www-form-urlencoded
→ Update a contact. Same body shape as POST. Used by conversion-cleanup to
  move contacts to ACTIVE_CUSTOMER (66233602) and to refresh notes.

DELETE /contacts/{user_id}
→ Remove a contact. Used by the rev-4 cleanup script.

GET /folders
→ List all folders with IDs and names. (NOT `/contacts/categories` — that 404s.)
  Response: { folders: { "0": {folder_id, folder_name, description}, "1": {...}, ... } }
```

### Webhook event

PhoneBurner fires `api_calldone` after every call. We receive it at:

```
POST /api/phoneburner/webhook?secret={WEBHOOK_SECRET}
```

Setup in PhoneBurner UI: Settings → API Webhooks → Add Webhook → Event `api_calldone`, URL above.

**Payload fields we use** (verified against the real Call End example payload — see §9 item 3 and `src/lib/sync/webhookProcessor.ts`):
- `status` (the disposition: Booked, Left VM, No Answer, Not Interested, etc.) — NOT `disposition`
- `duration` (seconds, number or string)
- `recording_url_public` (preferred) / `recording_url` (fallback) — NOT `call_recording_url`
- `agent.first_name` + `agent.last_name` (some payloads also send `agent.name`) — NOT `csr_name`
- `contact.user_id` — the PhoneBurner contact ID
- `contact.typed_custom_fields[]` — array of `{type, name, value}`; we look for `name === "Customer ID"` to find the Pocomos record
- `contact.notes` — FULL newline-separated history; `parseLatestNoteEntry` extracts the latest entry (PB prepends, so the first line that matches the date-header regex is newest)

### PhoneBurner gotchas

- Respect 429s — exponential backoff, max 3 retries
- 200ms pause between API calls
- Max ~5 concurrent calls
- Webhook MUST return 200 within 3 seconds — process the note write **async** via Next.js `waitUntil`
- Dedup by phone (10-digit, stripped) when bulk-loading

---

## 5. The Integration — How They Connect

> **STATUS: SHIPPED / LIVE since 2026-05-15.** The Pocomos ↔ PhoneBurner integration (lead sync, notes sync, conversion sweep, and the disposition webhook) is fully deployed and running in production, not planned. Real code + schedule:
> - `src/lib/sync/leadSync.ts` → `POST /api/phoneburner/sync-leads` Phase A (cron `*/15 * * * *`)
> - `src/lib/sync/notesRefresh.ts` → same route, Phase B (lazy 24h notes refresh)
> - `src/lib/sync/conversionSweep.ts` → `POST /api/cron/conversion-sweep` (cron `0 * * * *`, hourly — §5.5b)
> - `src/lib/sync/webhookProcessor.ts` → `POST /api/phoneburner/webhook` (event-driven `api_calldone`)
> - `src/lib/phoneburner/client.ts` + `folders.ts` (PB REST wrapper + folder IDs)
>
> The daily sales snapshot (`/api/cron/snapshot`, `0 5 * * *`) and mosquito refresh (`/api/cron/mosquito-status`, `0 6 * * *`) round out the four live crons. See "Current live state" near the top for the full cron table.

### 5.1 `/api/phoneburner/sync-leads` — Pocomos → PhoneBurner (cron, every 15 min)

This endpoint runs **two phases in sequence**: lead sync, then conversion cleanup. They share a request and return a combined result. The cron entry is in `vercel.json` and has been LIVE on a 15-minute schedule since 2026-05-15.

**Phase A — leadSync (Pocomos → PhoneBurner, new leads only)**

1. Get cached `PHPSESSID` via `getPocomosSession()` — refresh on first use, on `302→/login`, after 30 min idle. (Web back-door, NOT JWT — see §3.5.)
2. Read `last_sync_at` watermark from `sync_state` (key `phoneburner_last_sync_at`).
3. `POST /leads/data` with `statuses[]=Lead`, paginated (`length=100`), iterating until `aaData` is short.
4. Filter to leads where `date_added > last_sync_at` and `phone` is non-empty after stripping to 10 digits.
5. Skip if `phoneburner_contacts` already has the `pocomos_id`.
6. Skip if the Fresh folder (`66223880`) already has a contact with the same 10-digit phone.
7. Pull Pocomos notes via `getNotesForLead(leadId)`, filter out any whose `summary` starts with `📞 PhoneBurner Call —` (those originated from PhoneBurner — re-pushing them would loop), reverse-chronological sort.
8. Format notes block: 10 most recent in full; if more than 10, append `[+ N older notes from {oldest_year} — see Pocomos for full history: https://mypocomos.net/lead/{lead_id}/lead-information]`.
9. **Age-based folder routing (30-day rule) — LIVE v1 routing.**
   - Lead `date_added` within the last 30 days → `category_id = 66223880` (Fresh, Rena's active queue)
   - Older lead → `category_id = 66223881` (General — historical backfill bucket)
   Implemented in `src/lib/sync/leadSync.ts` (constant `THIRTY_DAYS_MS`; threshold is from `now`, not from the watermark — a stale lead is stale regardless of when we synced it). Tag-based routing (Competitor/Financial sub-folders) is still deferred to v2 — see §9.
10. `POST /contacts` to PhoneBurner (form-urlencoded, see §4) with the routed `category_id`, plus TWO custom_fields:
    - `custom_fields[0][name]=Customer ID`, `[0][value]={lead_id}`, `[0][type]=1`
    - `custom_fields[1][name]=Pocomos Profile`, `[1][value]=https://mypocomos.net/lead/{lead_id}/lead-information`, `[1][type]=1`
    This two-custom-field shape is the LIVE implementation. Top-level `website` was tried first; PB silently dropped it, so the Pocomos URL ships as the second custom_field (PB field id `994147`).
11. On success: insert `phoneburner_contacts` row with `last_notes_refresh_at = NOW()`.
12. Update `sync_state.phoneburner_last_sync_at` to `max(date_added)` of the leads actually processed.

**Phase B — notesRefresh (Pocomos → PhoneBurner, lazy notes refresh only)**

> **CHANGED 2026-06-16.** The folder-MOVE responsibility (active customers → Active Customer folder) was removed from this `*/15` route and rebuilt as the hourly roster-reconciliation **conversion sweep** — see §5.5b. The old `conversionCleanup` (which tried to DETECT conversions by re-reading each tracked lead's Pocomos status) is gone: it never evaluated the thousands of bulk-imported CSV contacts, and it assumed a converted lead flips to status "Customer" — which it does NOT (conversion spawns a NEW customer record and leaves the lead frozen at "Lead"). What remains in the `*/15` route is purely the notes refresh.

1. Select tracked `phoneburner_contacts` rows still in a policed folder whose `last_notes_refresh_at` is NULL or >24h old (oldest-first, capped at `NOTES_REFRESH_LIMIT`, default 40).
2. For each, pull current Pocomos notes (skip `source='pb'`), re-format using the same 10-most-recent rule, `PUT /contacts/{pb_id}` to update the `notes` field, set `last_notes_refresh_at = NOW()`.
3. Returns `{ refreshed_notes, checked, errors, duration_ms }`. READ-ONLY against Pocomos; the only write is the PB `notes` field. Lib: `src/lib/sync/notesRefresh.ts`.

**Combined result returned by the route:**
```jsonc
{
  "leadSync": { "added": N, "skipped_dup": N, "skipped_nophone": N, "errors": [], "duration_ms": N },
  "notesRefresh": { "refreshed_notes": N, "checked": N, "errors": [], "duration_ms": N }
}
```

**Cron config in `vercel.json`** (snapshot + sync LIVE since 2026-05-15; conversion-sweep added 2026-06-16):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/snapshot", "schedule": "0 5 * * *" },
    { "path": "/api/phoneburner/sync-leads", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/conversion-sweep", "schedule": "0 * * * *" },
    { "path": "/api/cron/mosquito-status", "schedule": "0 6 * * *" }
  ]
}
```

### 5.2 `/api/phoneburner/webhook` — PhoneBurner → Pocomos (event-driven)

**Flow:**

1. Verify `?secret=` matches `WEBHOOK_SECRET` env var — reject 401 if not
2. Parse PhoneBurner payload
3. Extract Pocomos ID from `contact.custom_fields` where `name === "Customer ID"`
4. If missing, log warning and return 200 (don't fail the webhook)
5. Determine if it's a lead or customer (by folder, or by lookup)
6. For customers: resolve URL ID via `GET /customer/find-customer-by-office?suggest={ID}&active=1`
7. Build the note:
   ```
   📞 PhoneBurner Call — {disposition}
   Duration: {duration}s
   CSR: {csr_name}
   {notes if any}
   ```
8. POST to Pocomos:
   - Customer: `/jwt/pronexis/1512/customer/{url_id}/note/create` with `{ note, subject }`
   - Lead: `/jwt/1512/lead/{lead_id}/note` (path needs verification)
9. **Return 200 immediately**, run the note write in `waitUntil` background

### 5.3 `/phoneburner` (status page)

Read-only dashboard:
- Last sync time + how long ago
- Contacts added in last sync
- Total syncs today / this week
- Last 10 webhook calls received
- Folder contact counts

### 5.4 Bidirectional notes sync

Notes flow both directions, with strict prefix-based dedup so they never echo back.

**Pocomos → PhoneBurner (read into the contact `notes` field):**
- Pulled **once at contact creation** during `leadSync`.
- Refreshed **lazily** by `notesRefresh` (the `*/15` route's Phase B — `src/lib/sync/notesRefresh.ts`), but only when `last_notes_refresh_at > 24 hours ago` for that contact. The 24h floor exists to keep the pass cheap — most leads don't add 50 notes a day, and PhoneBurner's `notes` field doesn't render in real time anyway.
- **Loop guard:** when reading from Pocomos, **skip any note whose `summary` starts with `📞 PhoneBurner Call —`** — those originated from PhoneBurner via the webhook and re-pushing them would feed the loop.

**PhoneBurner → Pocomos (real-time, via the webhook):**
- Written on **every** `api_calldone` event regardless of disposition or whether the CSR typed a note. Full call history is preserved — even No Answer / Busy with no note get a row, so the customer record shows the contact attempt.
- **Loop guard:** when reading from PhoneBurner (we don't currently, but if a future sync does), **skip any note that starts with `[Pocomos]`** — those are echoes of Pocomos notes.

**Ordering in the PhoneBurner `notes` field:**
- Reverse chronological (newest first).
- Show the 10 most recent in full.
- If more than 10 notes exist, append a single line:
  ```
  [+ N older notes from {oldest_year} — see Pocomos for full history: https://mypocomos.net/customer/{url_id}/customer-information]
  ```

**Format strings (verbatim — these are the strings the prefix dedup keys off, do not edit casually):**

Pocomos → PhoneBurner (one note per line in the `notes` field):
```
[Pocomos] {YYYY-MM-DD} — {summary}
```

PhoneBurner → Pocomos (one Pocomos `summary`, multi-line):
```
📞 PhoneBurner Call — {disposition}
Duration: {duration}s · CSR: {csr_name}
Notes: {pb_note_text or "(none)"}
Recording: {call_recording_url or "(none)"}
```

The leading emoji + literal "PhoneBurner Call —" prefix is the loop guard for the Pocomos→PB direction. The `[Pocomos]` literal prefix is the loop guard for the PB→Pocomos direction. Both prefixes are case-sensitive and must match exactly — don't pluralize, don't drop the em-dash, don't swap the brackets.

---

### 5.5 `/service/overdue` — mosquito overdue-spray report (hybrid refresh)

In-season tool flagging active mosquito customers who haven't been serviced recently. The page reads `mosquito_service_status` instantly (never scrapes on load); a budget-capped, READ-ONLY refresh job (cron `0 6 * * *` + a lock-guarded "Refresh now" `POST /api/service/overdue`) fills it.

**Eligibility (tightened 2026-06-10).** A customer is eligible only if they are Active AND have a mosquito-family contract (`pest_contract.service_type` ∈ {Mosquito Control, Natural Mosquito Control, Mosquito Control - Weekly, Natural Mosquito Control - Weekly}) that is BOTH:
- **active** — contract status active, not cancelled, and (for **non-auto-renewing** contracts only) `date_end` not passed. Auto-renewing contracts keep a *stale* original `date_end` (a 2026 customer can still show `date_end="2022-01-28"`), so `date_end` is ignored when `auto_renew` is set — use the `autoRenew` flag now carried on the normalized contract, not `date_end`, to judge liveness.
- **carries a current-year tag** — a tag starting with `"${CURRENT_YEAR} -"` on that mosquito contract's OWN per-contract tags. This is the real zombie filter: an "Active in name only" account last sprayed 2021–2024 has no current-year tag and is dropped. A pinned "no spray yet" row therefore means a current-year signup awaiting their first service.

**Clock rule.** Any completed mosquito service (any service Type) resets the 15-day clock — NOT Regular-only. Overdue = last mosquito service > 15 days ago, OR no service yet (pinned to top). `INCLUDE_RESPRAY` / `COUNT_ANY_SERVICE_TYPE` in `mosquito.ts` are the toggles to narrow back to Regular(+Respray)-only.

**Bucket precedence (added 2026-06-12).** Each eligible customer is placed in exactly one bucket, evaluated in this order (`preServiceBucket()` in `mosquito.ts` handles 1–2 before any service-date logic):
1. **open balance > 0 → `paused_balance`** — spray is intentionally paused on unpaid accounts, so these are kept out of overdue and listed in their own "Service paused — open balance" section (balance + sign-up date shown, highest balance first). Balance comes from the Unpaid Invoices report (§3.6, `openBalance.ts`). This rule wins even over the new-signup exclusion. An add-on customer caught here never needs a scrape.
2. **signed up < `NEW_SIGNUP_GRACE_DAYS` (3) ago → `excluded_new`** — brand-new signups we simply haven't serviced yet; excluded from overdue (counted only). They reappear naturally once a spray is due.
3. **no mosquito service yet → `overdue`** (reason `no_service_yet`, pinned to the top of the overdue list).
4. **last mosquito service > 15 days → `overdue`**.
5. **else → `current`**.

**Sign-up date source (corrected 2026-06-14).** Sign-up is sourced from the **eligible mosquito contract's top-level `date_start`** (the SAME active contract that passed eligibility), carried on `EligibleCustomer.signUpDate` from the JWT `/customer/{id}/contracts` data the dataset already fetches. This is what Pocomos's Edit / Service Information screen labels "Date Signed Up". It replaces `/customers/data` column 7 (`profile.date_signed_up`), which is the customer's *original first* signup and is **stale for re-signed customers** — e.g. Ashley Maiorano's col 7 reads 2022-05-27 but her active contract started 2026-06-09; Avram Isakov's reads 2025-05-16 but his active mosquito contract started 2026-06-10. **Never `date_end`** (stale on auto-renew contracts — Ashley's reads 2023). This same `date_start` now drives the **new-signup grace exclusion** (rule 2), so a customer who *re-signs* within the last 3 days is correctly held back as brand-new instead of showing a years-old date and a huge "days since". Confirmed by `scripts/probe-signup-discrepancy.ts`.

**Next scheduled (added 2026-06-14).** Every row also shows the customer's **next scheduled service** date, sourced from `/customers/data` column 9 ("Next Service") — already in the bulk row pulled for last-service (col 8), so no extra calls. Customer-level / any-type (same approximate-for-add-ons caveat as last-service).

**Weekly pill (added 2026-06-14, display-only).** Rows for a weekly-cadence mosquito customer show a small inline "Weekly" pill next to the name. Detected via `isWeeklyContract()` from the mosquito contract's `service_frequency` and/or `service_type` name containing "Weekly" (bi-weekly excluded — it also contains the substring "weekly"). **Does NOT change the overdue threshold** — the flat 15-day line still applies to everyone; this is purely a visual marker.

Every row (overdue / paused / needs-check) shows the customer's **sign-up date** (active mosquito contract `date_start`), **next scheduled service** (col 9), and a **Weekly** pill when applicable.

**Scheduled-today rescue (added 2026-07-07).** An overdue row whose **next scheduled service is today** (`next_service_date == today`, **Eastern**) is being handled today, so it is: (a) tinted **green** with a small "Today" pill on the next-scheduled cell, and (b) **excluded from the overdue COUNT** — the Overdue stat shows an "Excludes N scheduled for today" sub-line. The row STAYS VISIBLE in the overdue table (just green, not counted). This is computed at **read time** in `getOverdueReport()` (`refresh.ts`, `easternTodayIso()` + a `scheduled_today` flag on each row and a `counts.scheduledToday`), NOT stored — so "today" is always the day you're viewing, independent of when the daily 06:00 refresh ran. The `mosquito_service_status` schema is unchanged.

**Sticky table headers (added 2026-07-07).** The overdue / paused / needs-check tables (shared `RowTable` in `overdue-view.tsx`) pin their header row while scrolling via `position: sticky` (Tailwind `[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:z-10 [&>tr>th]:bg-background` on the `thead`), within the normal page scroll.

**Row coloring + Profile link (added 2026-06-15).** Overdue rows are tinted by days since last mosquito service: **17–20 → yellow, 21+ → red, <17 (or unknown) → normal** (green scheduled-today overrides these). Thresholds are named constants in `overdue-view.tsx` (`LATE_DAYS = 17`, `VERY_LATE_DAYS = 21`), distinct from the 15-day `OVERDUE_THRESHOLD_DAYS` (bucketing) in `mosquito.ts`. There is a clearly-commented hook in `rowToneClass()` for a future **"48h rescue"** override (a row with an ASSIGNED job within 48h will drop back to normal once the assigned-only next-scheduled date is sourced — see the scheduled-services probe; NOT implemented yet). The per-row link now reads **"Profile"** and points at `https://mypocomos.net/customer/{pocomos_id}/service-information` (the 7-digit Pocomos url id) for overdue/paused rows; needs-check rows keep a **"History"** link to `/service-history` (so the contract can be switched + read).

**Hybrid source (the speed fix — ~1–2 min vs ~30 min).** The JWT contract object has no usable last-service date (§9), so:
1. **Bulk** — `POST /customers/data` (~6 pages) → every customer's "Last Service" date (column 8) **and next-scheduled date (column 9)**, plus `POST /finance/unpaid-data` (one report, §3.6) → every customer's open balance. Sign-up comes from the eligible mosquito contract's `date_start` (JWT, not the grid — see the sign-up note above), so col 7 is no longer read for sign-up. Precedence rules 1–2 and **mosquito-only** eligible customers (no active non-mosquito contract, ~79%) are all resolved here — no scrape.
2. **Scrape** — **add-on** eligible customers (~21%) with no balance and not brand-new get the per-page `GET /customer/{id}/service-history` scrape (Surface C, READ-ONLY, never switches the selected contract) so the date is mosquito-contract-specific. If the rendered table's contract isn't mosquito, the customer is recorded as `needs_check` rather than mutated.

First live full refresh with balances + sign-up + new buckets (2026-06-12): **1,088 eligible · 68 overdue (1 "no service yet") · 29 paused-open-balance · 984 current · 2 excluded-new · 5 needs-check · 0 failed, ~140s** (85 customers owe $29,538.34 across all statuses; 29 of them are eligible mosquito accounts). Prior baseline (2026-06-10, before this change): 1,093 eligible / 81 overdue / 1,006 current / 6 needs-check. Code: `src/lib/service/{mosquito,customersData,openBalance,refresh,serviceHistory}.ts`, `src/components/overdue-view.tsx`, `src/app/service/**`, cron `src/app/api/cron/mosquito-status/route.ts`.

### 5.5b `/api/cron/conversion-sweep` — PhoneBurner active-customer sweep (hourly, roster-reconciliation, 2026-06-16)

Keeps active customers OUT of the outbound dial/cancelled queues. Replaces the old `conversionCleanup` (§5.1 Phase B), which was structurally broken (see below).

**Why the old model failed (confirmed in live data).**
1. **It only iterated the `phoneburner_contacts` Neon table.** The ~thousands of bulk-imported (5/14 CSV) PhoneBurner contacts were never in that table, so they were *never evaluated*.
2. **It assumed a converted lead flips to status `Customer`.** It does NOT. In Pocomos, converting a lead **creates a brand-new customer record** and leaves the original lead frozen at status `Lead`, with **no id link back**. Example: Igor Lipkin is active customer (external id 198709, Pocomos internal id 1217555, tag `2026 - Renewed`) yet sat in TWO dial folders — a Cancelled–Personal contact storing `198709` and a General contact storing the frozen lead id `5505704`.

**The new model — reconcile against the active roster, don't detect conversions.** Each run asks, per contact, "**is this contact a current active customer right now?**" and sweeps matches out. No conversion detection, no per-contact Pocomos status calls.

**Step 1 — build the active roster (one bulk pull, cached for the run).** Source = `getDataset()` (`src/lib/pocomos/dataset.ts`) — the dashboard's canonical active-customer builder, the same source behind the `/sales` "Active Customers" headline. **Active = the SAME definition the Sales dashboard uses: status `Active` AND ≥1 tag starting with `"${CURRENT_YEAR} -"`** (New Sale / Auto / SEB / EB / Renewed / …). Two in-memory indexes:
- `byCustomerId`: Set of normalized **internal** Pocomos customer ids.
- `byPhone`: Map normalized-10-digit-phone → `{ customerId (internal), lastName }`.

> **Probe finding (2026-06-16, `scripts/probe-roster-reconcile.ts` / `probe-pb-folders.ts` / `probe-extnum-tags.ts`).** Neither bulk Pocomos source exposes the user-facing **external** customer number (198709-style) or per-customer tags: `/customers/data` and the JWT customer-list **both key on the internal id (1217555-style)** and carry no Tags column; `find-customer-by-office` returns nothing in bulk. PhoneBurner's stored "Customer ID" custom field, however, holds **external customer numbers or frozen lead ids** — so a direct id match against the internal-id roster fires **0 times in practice** (verified across all 4,276 policed contacts). The **phone bridge is the actual workhorse**; the internal-id path is kept as a correct, cheap identity check (and future-proofing). The external number is intentionally NOT resolved per-contact — that would be thousands of Pocomos calls and violates the one-bulk-pull rule.

**Step 2 — sweep the policed folders (walk LIVE PhoneBurner folders, NOT the Neon table).** For each contact in the policed folders (`listContactsInFolder`, page_size 500), read its "Customer ID" custom field + phone, then:
- **(a)** stored Customer ID ∈ `byCustomerId` → MATCH (direct, by id).
- **(b)** else normalized phone ∈ `byPhone` AND the contact's **last name matches** that customer's last name (case-insensitive) → MATCH (phone bridge — for orphaned leads + external-number CSV contacts like both of Igor's).
- **(c)** phone matches but last name differs → **DO NOT move**; logged as `conversionSweep.name_mismatch_review` (covers spouses/relatives, "Current Resident", placeholder numbers, etc.).
- **(d)** no match → leave in place.

On MATCH: `PUT /contacts/{id}` with `category_id = 66233602` (Active Customer), and upsert a `phoneburner_contacts` row (`pocomos_id` = resolved active **internal** customer id, `pocomos_type='customer'`, `folder_id=66233602`, `last_updated_at=NOW()`); a stale row carrying the same `pb_contact_id` (e.g. the frozen-lead row) is re-pointed at the destination too. **The Neon table is now a cache, not the gate.** A person split across two contacts (like Igor) matches on both and both are moved — correct.

**Read/write phasing (idempotency + correctness).** The sweep enumerates ALL policed folders first (read phase), THEN performs the moves (write phase). Moving a contact mid-walk shrinks the folder and slides the `page_size` pagination offsets, which would skip later contacts in the same pass; phasing avoids that so one run is complete. Re-running moves nobody once everyone's in Active Customer (they leave the policed folders). Respects PhoneBurner limits (200ms between calls, ≤5 concurrent, exponential backoff on 429 — all in `phoneburner/client.ts`).

**Folders (`src/lib/phoneburner/folders.ts`).**
- **`POLICED_FOLDERS`** (the sweep's ONLY input — walked + swept): Fresh `66223880`, General `66223881`, Competitor `66223882`, Financial `66223883`, Cancelled buckets `66223884`–`66223888`.
- **`DESTINATION_FOLDER`**: Active Customer `66233602`.
- **`EXEMPT_FOLDERS`** (NEVER touched): Active Customer `66233602`. Exemption is **structural** — the sweep only reads `POLICED_FOLDERS`, so anything not policed is already ignored. **RULE: a future active-customer CALLING project will own folders that hold active customers on purpose — add each such folder to `EXEMPT_FOLDERS` (and NEVER to `POLICED_FOLDERS`) so this sweep keeps leaving them alone.**

**Cadence.** Own hourly cron `{ "path": "/api/cron/conversion-sweep", "schedule": "0 * * * *" }`. Decoupled from the lead-push sync, which stays `*/15` (now lead-push + lazy notes refresh only — §5.1). `dryRun` flag (`?dryRun=1` on the route) counts without moving.

**First live run (2026-06-16, `scripts/run-conversion-sweep.ts`).** Dry: 4,276 scanned · 0 by-id · 49 by-phone · 13 name-mismatch-skipped · 49 would-move · roster 1,104 active. Both Igor contacts (lead `5505704` in General, customer `198709` in Cancelled–Personal) confirmed in the would-move set (kind=phone, resolved=1217555). Live: **49 moved, 0 errors**; both Igor contacts verified in folder `66233602`. Idempotent re-run: **0 would-move** (only the 13 name-mismatches remain, correctly skipped). Code: `src/lib/sync/conversionSweep.ts`, `src/app/api/cron/conversion-sweep/route.ts`.

### 5.6 `/leads` — lead close-rate tab (2026-06-16)

Top-level **Leads** tab (nav order: Sales · Leads · Calling · Combined · Service). Landing is a raw close-rate summary.

**Metric (v1 — raw only):** `Raw close rate = (leads created in the period whose status is now "Customer") ÷ (all leads created in the period, any status) × 100`, bounded by `date_added`. On-screen description: *"Raw close rate — share of leads created in this period that became customers. Does not yet exclude unreachable or wrong-number leads."* Default period = Jan 1 of the current year → today, with a date-range control.

**Source: the Lead Advanced Search feed (two-step, session-scoped).** Both numerator AND denominator come from this one feed — NOT `/leads/data`. The plain `/leads/data` "View All" list is server-scoped to OPEN leads only (Lead / Not Interested / Monitor) and can never return Customer rows (no param changes that — confirmed). Converted leads are reachable only via Advanced Search:
1. **Set criteria** (`setAdvancedSearchCriteria`): GET `/leads/advanced-search/show`, scrape `search[_token]`, then POST `/leads/lead-advanced-search` (form-urlencoded, returns HTML) with `search[_token]`, `search[branches][]={office}`, `search[allBranches]=1`, and `search[leadStatus][]` repeated for **all five statuses** (Lead, Not Home, Not Interested, Customer, Monitor); all other `search[...]` text inputs sent empty. Referer `/leads/advanced-search/show`. This stores the criteria in the PHP session. Re-logs once on session expiry.
2. **Pull rows** (`fetchAllLeads`): POST `/lead/lead-advanced-search/data` (legacy DataTables 1.9 body, 200/page) → `aaData` keyed objects: `id, status, date_added, salesperson, first_name, phone`.

Code: `src/lib/leads/closeRate.ts` (`setAdvancedSearchCriteria`, `fetchAllLeads`, `computeReport`, `computeCloseRate`, `refreshCloseRate`), `GET/POST /api/leads/close-rate`, `src/app/leads/page.tsx`, `src/components/leads-view.tsx`. Probes that proved the flow: `scripts/probe-adv-search.ts`, `probe-adv-form.ts`, `probe-customer-leads2.ts`, `probe-adv-all.ts`.

**Layout:** team headline (raw close rate + total leads + conversions), a sortable per-rep table (one row per salesperson: leads / conversions / close rate, with a TOTAL row), and an **Unattributed** bucket. Attribution: a lead is Unattributed when `salesperson` is blank or in the `NON_CSR` set (`api user`, `pronexis`, `system`, `admin`, …) — kept out of rep denominators rather than distorting them.

**Storage:** singleton Neon table `leads_close_rate` (id=1) caches the latest default-period report so the tab paints fast; `POST /api/leads/close-rate` recomputes + caches (manual "Refresh now"; cron optional later). Custom date ranges are computed live (`GET ?start&end`) and not cached.

**Real-lead hook:** `isRealLead(row)` in `closeRate.ts` is a v1 no-op (returns true) applied to the denominator — the clearly-commented place where a future "real close rate" will exclude unreachable / wrong-company leads (e.g. `reason_name` in {Can't Reach, Competitor}). NOT implemented yet.

**RESOLVED (2026-06-16) — earlier "converted leads leave the module" note was WRONG.** Converted leads are NOT gone; they were simply unreachable via `/leads/data` (the open-leads list). The Advanced Search two-step above returns them. Earlier confusion: `/leads/data` with `statuses[]=Customer` or `search[leadStatus][]=Customer` returns 0/ignores it because that list is hard-scoped to open leads; the criteria only take effect on the Advanced Search feed after the form POST registers them in session. The `conversionSourceMissing` banner has been removed.

**Live numbers (YTD 2026-01-01 → today, single feed, all five statuses):** denominator **324** (Lead 232 + Customer 76 + Not Interested 16), numerator **76**, **raw close rate 23.5%**. Per-rep denominators: Rena Shlomo 203 / Rivka Leyton 120 / Brittany McAuliffe 1; conversions: Rena 48 / Rivka 27 / Brittany 1; unattributed 0. (NB: the old `/leads/data` denominator of 248 was wrong — it excluded the 76 converted, which would overstate the rate; the single-feed denominator of 324 is correct.)

---

### 5.7 `/texting` — Aerialink texting archive + the app's only auth gate (2026-06-16)

Read-only inbox-style archive of the Aerialink SMS history. Left pane lists conversations (newest activity first) with search by number/name/email/message; right pane renders the full thread bubble-style with inbound/outbound sides and per-day dividers. Built from two Neon tables (`texting_messages`, `texting_contacts` — see §7) imported once via root-level `import-texting.mjs` from `aerialink_open_messages.csv` + `aerialink_open_conversations.csv`.

Search is **server-authoritative** (2026-06-16, commit `cdf1b3f`): the box hits `?find=` which queries `texting_contacts` directly (last-10 + `phone_full` all-digits `LIKE`, plus name/email/city/last_message `ILIKE`, `LIMIT 300`), so a full phone number always finds its conversation even when the client's in-memory list is capped/partial. Digit-only queries ≥3 chars also match on the phone columns.

Code: `src/app/texting/page.tsx` (client inbox), `src/app/api/texting/search/route.ts` (`?list=1` left pane, `?find=` DB-direct conversation search, `?cid=` thread, `?q=` body search), `src/app/texting/login/page.tsx` (login screen), `src/app/api/texting/login/route.ts` (password check + cookie), `src/middleware.ts` (the gate), `import-texting.mjs` (one-time loader).

**Auth gate — this is the ONLY login in the entire app.** Every other page (`/`, `/sales`, `/leads`, `/service`, …) and most data APIs render publicly with no auth. Because the texting archive exposes customer names, emails, addresses and phone numbers, `src/middleware.ts` gates **only** `/texting`, `/texting/*`, and `/api/texting/*` behind a shared password (`TEXTING_PASSWORD` env var). Decision (2026-06-16): scope the gate to texting only, leaving the rest of the dashboard as-is.

How it works:
- `matcher: ['/texting', '/texting/:path*', '/api/texting/:path*']`. `/texting/login` and `/api/texting/login` are explicitly allow-listed so the login flow is reachable without a cookie.
- The login POST compares against `TEXTING_PASSWORD` and, on match, sets an httpOnly `texting_auth` cookie holding `SHA-256("ms-texting:" + password)` (the plaintext never lives in the browser). Middleware recomputes the same token via Web Crypto and string-compares.
- **Fail-closed:** if `TEXTING_PASSWORD` is unset, no cookie can match → pages stay locked (page → 307 to `/texting/login`; API → 401). No PII leaks when misconfigured.
- Cookie TTL 30 days. To rotate/revoke: change `TEXTING_PASSWORD` in Vercel (invalidates all existing cookies since the token changes).

Live verification (2026-06-16, `https://ms-operations-hub.vercel.app`): API without cookie → 401; `/texting` without cookie → 307 to login; wrong password → 401; correct password → 200 + cookie; with cookie API → 200 returning 6,430 conversations.

---

### 5.8 `/sales` return rate — year-over-year mosquito retention (2026-07-07)

A "Return rate" card on `/sales` (compact on `/tv/sales`) showing how many of one season's real mosquito customers came back the next season, for the two most recent year pairs (year-relative: `[CY-2 → CY-1]`, `[CY-1 → CY]`; for 2026 that's 24→25 and 25→26). Computed inside `getSalesTaxonomy()` (`src/lib/sales-taxonomy.ts`, `computeReturnRates()`) and served by the existing `/api/sales/taxonomy` endpoint + `useSalesTaxonomy()` hook — no extra Pocomos fetch (it reuses the dataset already loaded for the taxonomy).

**Definitions (probe-confirmed 2026-07-07):**
- **Real year-Y customer** = holds a **mosquito-family contract** (`service_type` ∈ the §5.5 mosquito set) whose OWN per-contract tags carry a `"{Y} -"` season tag. **Tag alone is NOT sufficient** — there must be a mosquito contract, so **Event-Spray-only customers are excluded** (only 18 of them exist). Auto-renewing mosquito contracts accumulate each season's tag on one contract, so one contract can be "real" across several years.
- **Returned** applies a status/deactivation guard to the destination year so a **mid-season cancel doesn't count as a return**: `realValidated(Y) = real(Y) AND NOT (currently Inactive with last completed service in year Y)`. Active customers are never mid-season cancels (finishing / renewed). Data sources: active customers' contracts from the live dataset; non-active from the enriched `customers` table's `contracts` jsonb (2,667 of 2,758 enriched carry contracts).
- **Denominator — two variants (PENDING an ops decision on which is canonical):** primary = all real {from} customers (mid-season cancels count against the rate); `exclDenom` = real {from} minus mid-season {from} cancels. Same numerator for both; `returned ⊆ exclDenom`, so `exclRate` never exceeds 100%. The card shows the primary rate big and the excl-mid-season rate + denominator in a sub-column.

**Live numbers (verified on the deployed `/api/sales/taxonomy`, 2026-07-07):** 24→25 = **73.4%** (956/1303; excl mid-season **88.6%**, 224 removed), 25→26 = **74.0%** (1079/1458; excl mid-season **94.5%**, 316 removed); 18 event-spray-only excluded. NOTE these are LOWER than a naive tag∩tag intersection (which gave 88.8% / 75.9% in the raw probe) precisely because the shipped numerator applies the **mid-season-cancel guard to the "returned" side** per spec — a customer who re-enrolled the next season but cancelled mid-that-season is NOT counted as a return. STRICT (contract-level) and LOOSE (union-tag) real-customer sets agree within ~2 customers; STRICT is used.

---

## 6. File Structure (shipped)

Actual deployed tree (verified against the source 2026-07-07):

```
src/
├── middleware.ts                      ← the texting-only auth gate (§5.7)
├── lib/
│   ├── db.ts                          ← Neon client, initSchema (all 7 initSchema tables), getSyncState/setSyncState
│   ├── snapshots.ts                   ← writeSnapshot, listSnapshots
│   ├── enrichment.ts                  ← enrichInactiveCustomers (overnight)
│   ├── sales-data.ts / sales-taxonomy.ts   ← sales summary shaping + taxonomy for /sales
│   ├── utils.ts
│   ├── pocomos/
│   │   ├── auth.ts                    ← JWT token mint + cache
│   │   ├── client.ts                  ← JWT API wrapper (Surface A: getJson, pocomosOffice)
│   │   ├── webSession.ts              ← PHPSESSID cache, Symfony login, postSessioned/getSessionedHtml (Surface B/C)
│   │   ├── notes.ts                   ← getNotesForLead/Customer, formatNotesForPhoneBurner (JSON-first, HTML fallback)
│   │   ├── categorize.ts              ← bucket logic + CURRENT_YEAR (NEW/RETURNING/RETAINED/AT_RISK/CANCELLED)
│   │   ├── tags.ts                    ← office tag dict (/jwt/pronexis/tags/list/{office}) + tagsForCustomer/Contract
│   │   ├── contract-tags.ts           ← per-contract tags GET (/jwt/office/{office}/contract/{pcId}/tags)
│   │   ├── contracts.ts / customers.ts / dataset.ts / dataset-types.ts / sales-provider.ts / pool.ts / index.ts
│   │   ├── interactionTypes.ts        ← probes accepted `interactionType` values for note/create
│   │   └── types.ts
│   ├── phoneburner/
│   │   ├── client.ts                  ← createContact, updateContact, listContactsInFolder, normalizePhone
│   │   └── folders.ts                 ← FOLDERS + POLICED_FOLDERS / DESTINATION_FOLDER / EXEMPT_FOLDERS (§5.5b)
│   ├── sync/
│   │   ├── leadSync.ts                ← Phase A: Pocomos → PhoneBurner, age-based folder routing, watermark advance
│   │   ├── notesRefresh.ts            ← */15 Phase B: lazy 24h PB notes refresh for tracked contacts (§5.1)
│   │   ├── conversionSweep.ts         ← hourly roster-reconciliation active-customer sweep (§5.5b)
│   │   └── webhookProcessor.ts        ← PB webhook payload parser (status, recording_url_public, agent, contact.notes)
│   ├── leads/
│   │   └── closeRate.ts               ← Advanced Search two-step feed → raw close-rate report (§5.6)
│   ├── service/
│   │   ├── mosquito.ts / customersData.ts / openBalance.ts / serviceHistory.ts / refresh.ts   ← /service/overdue (§5.5)
│   └── sheets/
│       └── csv.ts / provider.ts / categorize.ts / types.ts / index.ts   ← Google-Sheets CSV fallback provider
├── components/
│   ├── nav.tsx / shell.tsx / refreshed-at.tsx
│   ├── sales-view.tsx / tv-sales-view.tsx / overdue-view.tsx / leads-view.tsx
│   ├── use-live-sales.ts / use-sales-taxonomy.ts
│   └── ui/ (button.tsx, card.tsx)     ← shadcn primitives
└── app/
    ├── layout.tsx / page.tsx
    ├── sales/page.tsx · tv/sales/page.tsx · service/page.tsx · service/overdue/page.tsx
    ├── leads/page.tsx · combined/page.tsx · calling/page.tsx
    ├── texting/page.tsx · texting/login/page.tsx
    └── api/
        ├── cron/snapshot/route.ts            ← daily 05:00 snapshot  (cron 0 5 * * *)
        ├── cron/conversion-sweep/route.ts    ← hourly active-customer sweep  (cron 0 * * * *, §5.5b)
        ├── cron/mosquito-status/route.ts     ← daily 06:00 mosquito rebuild  (cron 0 6 * * *, §5.5)
        ├── snapshots/route.ts                ← snapshot read endpoint
        ├── sales/live/route.ts               ← live sales revalidation feed (§3.5 "Load path")
        ├── sales/taxonomy/route.ts           ← sales taxonomy feed
        ├── service/overdue/route.ts          ← overdue report read/refresh
        ├── leads/close-rate/route.ts         ← GET cached / ?start&end live; POST recompute (§5.6)
        ├── phoneburner/
        │   ├── sync-leads/route.ts           ← every 15 min: leadSync (Phase A) + notesRefresh (Phase B)
        │   └── webhook/route.ts              ← `api_calldone` receiver, writes Pocomos note via waitUntil
        └── texting/
            ├── search/route.ts               ← ?list= / ?find= / ?cid= / ?q= (§5.7)
            └── login/route.ts                ← password check → texting_auth cookie

import-texting.mjs                            ← root-level one-time Aerialink CSV → Neon loader (§7)
```

Notes: `src/app/phoneburner/page.tsx` (the old PB status page) is no longer in the tree — the PB flow is cron-driven and observed via `webhook_log`. The planned `sync/state.ts` / `sync/leadRouter.ts` never became their own files (watermarks live in `db.ts`; routing is inline in `leadSync.ts`). `lib/sheets/` is the Google-Sheets CSV fallback data provider (parallel to the Pocomos provider).

### 6.1 UI / styling conventions (visual-polish pass, 2026-06-16)

Display-only conventions for the dashboard views (no data logic lives in components). Established during the visual-polish pass:

- **Type scale (one scale):** page title `text-2xl font-semibold tracking-tight`; headline KPI numbers `text-3xl sm:text-4xl` (the `size="hero"` tiles — Active Customers, Active Services, Overdue); standard tile numbers `text-2xl`; tile labels `text-xs font-medium uppercase tracking-wide text-muted-foreground`; body/descriptions `text-sm text-muted-foreground`; fine-print hints `text-[11px]`/`text-xs` muted.
- **Tile geometry (uniform):** `rounded-lg border bg-card p-4 sm:p-5`, `tabular-nums` on all figures. Section cards use the shared shadcn `Card` (padding tightened to `p-5`). TV tiles use the larger `rounded-xl`.
- **Status palette — meaningful color only.** A single shared `TONE` map is used in both `sales-view.tsx` and `overdue-view.tsx`: `neutral` (default foreground), `healthy` = emerald, `attention` = amber, `action` = rose/red. The amber/red here are the **same** hues as the overdue table row tints (`LATE_DAYS`/`VERY_LATE_DAYS`). Most of the UI stays neutral; color is reserved for things needing a human — e.g. Sales "Not Renewed" → amber; Overdue stat → red, Paused/Needs-check → amber, Current → emerald. No decorative per-category colors. (The old TV per-bucket rainbow and the sky "Weekly" pill were removed for this reason.)
- **Visual hierarchy:** headline KPIs dominate (hero size); bucket breakdown is the secondary grid; all-time/untagged totals recede. On `/sales` the layout is three groups (KPIs → buckets+reconciliation → all-time) instead of one flat row.
- **Browser vs TV split:** the dense inline definitions + reconciliation line live on `/sales` only; `/tv/sales` stays minimal, high-contrast, and glanceable (big neutral numbers, labels recede, no definition text).

---

## 7. Database — Neon Postgres (already live)

Provisioned via Vercel Marketplace as `neon-indigo-dog`. Auto-wired env vars. Driver: `@neondatabase/serverless` via `src/lib/db.ts`; `initSchema()` creates seven of the tables idempotently (the two `texting_*` tables are created by `import-texting.mjs`).

**Nine tables exist as of 2026-07-07** (live `information_schema` query): `snapshots` (55 rows), `customers` (2,758), `sync_state` (5), `mosquito_service_status` (1,146), `leads_close_rate` (1), `phoneburner_contacts` (276), `webhook_log` (129), `texting_contacts` (6,566), `texting_messages` (48,713). All PhoneBurner tables are LIVE — the "Tables to add" framing below is historical; they were created long ago.

### Existing tables

**`snapshots`** — one row per Eastern calendar date, UPSERTed by the daily cron.
Columns: `id, snapshot_date, active_count, services_count, new_count, returning_count, retained_count, retained_auto, retained_seb, retained_eb, at_risk_count, cancelled_count, cancelled_2026, cancelled_2025, cancelled_2024, cancelled_2023, cancelled_2022, cancelled_2021, on_hold_count, untagged_count, raw_json (jsonb)`

**`customers`** — enriched non-active customers (Inactive + On-Hold), **2,758 rows as of 2026-07-07**.
Populated by the resumable `enrichInactiveCustomers({ budgetMs, maxCustomers })` job that skips IDs already at `depth='full'` via a `refreshed_at` watermark. Columns (live): `pocomos_id, status, full_name, first_name, last_name, email, phone, zip, date_created, last_service_date, next_service_date, cancel_date, sales_status, marketing_type, depth, tags (jsonb), contracts (jsonb), refreshed_at`.

**`mosquito_service_status`** — one row per eligible mosquito customer, backing `/service/overdue`. Filled by the hybrid refresh job (see §5.5); the page reads this table instantly and never scrapes on load.
```sql
CREATE TABLE mosquito_service_status (
  pocomos_id TEXT PRIMARY KEY,
  full_name TEXT,
  mosquito_contract_type TEXT,
  selected_contract_label TEXT,      -- only set on needs_check rows (scrape path)
  last_regular_spray DATE,           -- last mosquito service (any type); NULL = no service yet
  days_since INTEGER,                -- NULL = no service yet (pinned to top of overdue)
  status TEXT NOT NULL,              -- 'overdue' | 'current' | 'needs_check' | 'paused_balance' | 'excluded_new'
  reason TEXT,                       -- 'overdue' | 'current' | 'no_service_yet' | 'mosquito_not_selected' | 'open_balance' | 'new_signup'
  sign_up_date DATE,                 -- active mosquito contract date_start (re-sourced 2026-06-14; was /customers/data col 7); shown on every row
  open_balance NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Unpaid Invoices report (§3.6); >0 → paused_balance bucket
  next_service_date DATE,            -- /customers/data col 9 "Next Service" (added 2026-06-14); shown on every row
  is_weekly BOOLEAN NOT NULL DEFAULT FALSE,  -- weekly-cadence marker for the display-only "Weekly" pill (added 2026-06-14)
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
The `sign_up_date` and `open_balance` columns were added 2026-06-12; `next_service_date` and `is_weekly` were added 2026-06-14. `initSchema()` includes all of them in the `CREATE` and also runs `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for environments where the table predates them. (As of 2026-06-14 `sign_up_date` is populated from the active mosquito contract's `date_start`, not grid col 7 — see §5.5.)

**`texting_messages`** / **`texting_contacts`** — the Aerialink texting archive, backing `/texting` (see §5.7). Loaded by the one-time `import-texting.mjs` script from the CSV exports; safe to re-run (drops + rebuilds each time). 47,114 messages across ~6,420 phone numbers / 6,430 conversations as of 2026-06-16.
```sql
CREATE TABLE texting_contacts (
  conversation_id TEXT PRIMARY KEY,
  phone TEXT, phone_full TEXT,          -- last-10 + all-digits
  first_name TEXT, last_name TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  last_message TEXT, status TEXT,
  updated_at TIMESTAMPTZ                -- drives the left-pane ordering
);
CREATE TABLE texting_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT,
  phone TEXT, phone_full TEXT,          -- the CONTACT's number (keyed by conversation_id), NOT our business line
  body TEXT,
  sent_at TIMESTAMPTZ,
  direction TEXT,                       -- raw value of the export's "from" column
  is_inbound BOOLEAN                    -- derived: true = from customer, false = from us
);
```
**Import gotcha (fixed 2026-06-16):** the messages CSV has a `mobile_user` column that actually holds *our* business line, so keying the phone off it tagged every message with the same number (only 2 distinct). `import-texting.mjs` now takes the phone from `phoneByCid.get(conversation_id)` (the contacts file) first, falling back to the message column only when empty — which also fixes inbound/outbound detection.

**`leads_close_rate`** — singleton cache (row `id = 1`) for the `/leads` close-rate tab (§5.6). Holds the latest computed default-period report so the tab paints instantly; custom date ranges are computed live and NOT cached. Created by `initSchema()`; written by `refreshCloseRate()`.
```sql
CREATE TABLE leads_close_rate (
  id INTEGER PRIMARY KEY,          -- always 1 (singleton)
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  report JSONB NOT NULL,           -- full LeadsCloseRateReport (totals, reps[], statusBreakdown)
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### PhoneBurner tables (LIVE — created 2026-05-15)

> Historically titled "Tables to add"; all three exist and are in active use. `sync_state` also backs the leads close-rate refresh lock and the snapshot job.

**`sync_state`** — key/value table (5 keys live) holding watermarks + locks.
```sql
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Key 'phoneburner_last_sync_at' holds { timestamp: '...', last_lead_id: ... }
```

**`phoneburner_contacts`** — maps Pocomos IDs to PhoneBurner contact IDs to prevent duplicates and tracks lazy notes refresh.
```sql
CREATE TABLE phoneburner_contacts (
  pocomos_id TEXT PRIMARY KEY,
  pocomos_type TEXT CHECK (pocomos_type IN ('lead', 'customer')),
  pb_contact_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ,
  last_notes_refresh_at TIMESTAMPTZ        -- driven by §5.4 lazy refresh; NULL means "never refreshed since creation"
);
```

**`webhook_log`** — for debugging the status page.
```sql
CREATE TABLE webhook_log (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pocomos_id TEXT,
  pb_contact_id TEXT,                              -- added after initial ship (live)
  disposition TEXT,
  csr_name TEXT,
  note_written BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  raw_payload JSONB
);
```

### Neon gotchas

- The Neon driver hydrates DATE columns to JS `Date`. JSON serializes as ISO timestamp (`2026-05-14T00:00:00.000Z`). Trim to `YYYY-MM-DD` on the frontend.
- The Vercel-Neon install can overwrite `.env.local` with dev env vars. Pocomos credentials sit only on Production by default — re-append them after any `vercel env pull`.
- Removing the Neon integration is one CLI call: `vercel integration-resource remove <slug>`.

---

## 8. Env Vars

Required in Vercel + `.env.local`:

```bash
# Pocomos
POCOMOS_USERNAME=mstli.apiuser
POCOMOS_PASSWORD=mstli.apiuser
POCOMOS_OFFICE_ID=1512

# PhoneBurner
PHONEBURNER_TOKEN=exRZkIeTSL7wY0Q1MimzJRLmB3JWgvaatMmGhW6K
WEBHOOK_SECRET=<generate a random string>

# Texting archive (the ONLY auth gate in the app — see §5.7)
TEXTING_PASSWORD=<shared password; set on Production+Preview+Development>

# Neon (auto-set by Vercel Marketplace install)
POSTGRES_URL=...
POSTGRES_PRISMA_URL=...
POSTGRES_URL_NON_POOLING=...
# ... etc.
```

---

## 9. Open Questions / Known Gaps

Status as of May 18, 2026 — after the rev 5 shipping pass.

### Resolved

1. **Lead detail shape — RESOLVED (rev 3).** The JWT lead endpoints (`/jwt/{office}/lead/list`, `/jwt/{office}/lead/{id}`) really are shallow — phone/email/date are NOT exposed there at any depth. The web back-door `POST /leads/data` (Surface B in §3.5) returns those fields, and the lead sync uses it directly.

2. **Pocomos → PhoneBurner notes read — RESOLVED (rev 3).** `notes.ts` tries `GET /jwt/pronexis/{office}/customer/{url_id}/notes` (and equivalent lead path) first and falls back to scraping `/customer/{url_id}/customer-information` (or `/lead/{id}/lead-information`) HTML.

3. **PhoneBurner webhook payload field names — RESOLVED.** Real names documented in `src/lib/sync/webhookProcessor.ts`:
   - `status` (the disposition) — NOT `disposition`
   - `recording_url_public` (preferred), `recording_url` (fallback) — NOT `call_recording_url`
   - `agent.first_name` + `agent.last_name` — NOT `csr_name`
   - `contact.typed_custom_fields[]` (array of `{type, name, value}`) — `Customer ID` lives here
   - `contact.notes` is the FULL history string, newline-separated; `parseLatestNoteEntry` extracts the latest entry (PB prepends, so the first non-continuation line is newest)
   - `contact.user_id` is the PhoneBurner contact ID

4. **30-day age-based folder routing — LIVE in `src/lib/sync/leadSync.ts`.** New leads ≤ 30 days old route to Fresh (`66223880`); older leads route to General (`66223881`). Threshold is from `now`, not from the watermark.

5. **Pocomos URL via `Pocomos Profile` custom_field (PB field id `994147`) — LIVE.** PB silently drops a top-level `website` field, so the URL ships as the second custom_field. See §5.1 step 10.

6. **PhoneBurner contact list filter quirk — LIVE.** `GET /contacts?category_id={N}` correctly filters to the folder; `?folder_id={N}` is silently accepted and returns every contact in the entire account. `loadAllExistingPbPhones` in `leadSync.ts` relies on `category_id`. See §4.

7. **PhoneBurner write body shape — LIVE.** `POST /contacts` must be `application/x-www-form-urlencoded` with `phone` (not `raw_phone`) and `email` (not `email_address`); custom_fields use PHP-array form syntax (`custom_fields[0][name]=...&custom_fields[0][value]=...&custom_fields[0][type]=1`). JSON bodies are silently partial. See §4.

8. **Watermark advance on every evaluated lead — LIVE.** `leadSync.ts` advances `phoneburner_last_sync_at` for every lead it RESOLVES (added, `skipped_dup`, or `skipped_nophone`); only `errors` skip the advance, so the lead retries next tick. Earlier behavior of advancing only on successful adds left the watermark frozen whenever a page deduped entirely, causing the cron to re-fetch page 1 forever.

9. **Pocomos `/leads/data` is DataTables 1.9, not 1.10+ — RESOLVED (2026-05-18).** `POST /leads/data` uses legacy DataTables 1.9 form-data parameters (`iSortCol_0`, `sSortDir_0`, `mDataProp_N`, `iDisplayStart`, `iDisplayLength`, `sEcho`). Modern DataTables 1.10+ params (`order[0][column]`, `start`, `length`, `columns[N][...]`) are silently ignored and produce an unsorted default-order response. Symptom we hit: the watermark sat at 2024-12-17 for months because the response wasn't actually sorted desc by `date_added`, so the watermark short-circuit broke on whichever stale row appeared first and skipped all newer leads. Always send the legacy format; the canonical body lives in `leadSync.ts::fetchLeadsPage`. Note that the **response** shape was already legacy 1.9 (`aaData` / `iTotalRecords` per §3.5 Surface B) — it's just that the **request** shape was modern and silently mismatched.

11. **Reading lead data incl. converted leads — RESOLVED (shipped, 2026-06-16).** Two working, in-production paths, both READ-ONLY:
    - **Open leads:** `POST /leads/data` (server-scoped to Lead/Not Interested/Monitor) returns `id, phone, email, date_added, salesperson, status, marketing_type_name`. Powers the PhoneBurner lead sync (`leadSync.ts`).
    - **All statuses incl. converted "Customer":** the **Advanced Search two-step feed** — (1) `setAdvancedSearchCriteria()` scrapes `search[_token]` from `/leads/advanced-search/show` and POSTs `/leads/lead-advanced-search` with `search[leadStatus][]` for all five statuses (Lead, Not Home, Not Interested, Customer, Monitor) + branch + token, storing criteria in the PHP session; (2) `fetchAllLeads()` POSTs the legacy-1.9 DataTables body to `/lead/lead-advanced-search/data` and pages `aaData`. This is the ONLY feed that returns converted leads, and it powers the `/leads` close-rate (`src/lib/leads/closeRate.ts`, §5.6). Do NOT reuse the `/leads/data` denominator for close rate — it excludes converted leads and overstates the rate.

10. **No per-contract last-service date on the JWT contract object — RESOLVED (2026-06-10).** `GET /jwt/pronexis/{office}/customer/{id}/contracts` carries `date_start`/`date_end`/`renewal_date`, `invoices[].date_due` (billing schedule, not service completion), and `pest_contract.initial_job` (the INITIAL job only, with `date_completed`), but **no recurring/Regular completed-service date** for active mosquito contracts (`number_of_jobs = 0`, `initial_job = null`, and a `pest_contract.initial_job.last_regular_service` field that is always null in samples). So the contract object cannot supply last-mosquito-spray date — the `/service/overdue` report uses the `/customers/data` "Last Service" column instead (see §3.5 Surface B column map + §5.5). Probe: `scripts/probe-bulk-spray-date.ts`.

### Still open

1. **Lead *tag-chip* read (narrow gap — lead DATA is resolved, see Resolved #11).** Lead status/phone/email/date/salesperson are fully readable now, but there is still no working API path for reading a lead's **tag chips** (e.g. `L - Competitor`, `L - Financial`). Consequence: PhoneBurner lead routing is **age-based** (Fresh ≤30d / General older — shipped, §5.1), NOT tag-based. Tag-based sub-folder routing stays deferred. Possible v2 sources when one is needed:
   - The `marketing_type_name` field on `/leads/data` may proxy for the routing decision (e.g., a "Competitor switch" marketing type → folder `66223882`).
   - Scrape `/lead/{id}/lead-information` HTML for the tag chips (same Surface-C pattern `notes.ts` already uses).
   - **TODO if/when a working source lands:** route `L - Competitor` → `66223882`, `L - Financial` → `66223883`, skip `NT - No Marketing` and `L - DNC`. (Note: the office tag *dictionary* GET is `/jwt/pronexis/tags/list/{office}` and per-*contract* tags GET works — see §12 — but neither exposes a given lead's chips.)

2. **`notesRefresh` throughput.** The `*/15` Phase B refreshes at most `NOTES_REFRESH_LIMIT` (default 40) tracked contacts per tick, oldest-first. With a few hundred tracked lead rows that cycles every contact through inside a day; raise the cap if the tracked set grows materially. (The old `conversionCleanup`, which walked every tracked row every tick, is gone — see §5.5b.)

3. **Real-time Pocomos → PhoneBurner notes refresh.** PB-side notes are refreshed lazily by `notesRefresh` only when `last_notes_refresh_at > 24h ago`. A CSR opening a contact within that window sees stale notes. Real-time refresh would require either a Pocomos→hub webhook (Pocomos has no outbound webhooks — §12) or an on-demand "refresh now" link from the dialer.

4. **Active-customer upsell sync.** Customer No Add-Ons folder (`66229452`) was removed from PB on 2026-05-15 along with the v1 plan to feed active customers without renewal/upsell contracts into a follow-up bucket. Deferred until product decides what the upsell motion actually looks like.

5. **Assigned-only next-scheduled date (probe-confirmed 2026-06-15, NOT built).** The `/customers/data` col 9 "Next Service" (used today on `/service/overdue`) is **NOT assignment-aware** — Pocomos auto-creates a scheduled date as soon as a contract exists, so col 9 returns the earliest scheduled date regardless of whether a CSR has routed it. To show only *truly scheduled* jobs, source from the **per-customer** `GET /customer/{urlId}/scheduled-services` page (Surface C scrape), table `#scheduled-table`: columns `Date Scheduled (1) · Type (2) · Status (3) · … · Route Assigned (6) · Technician (7)`. **The assignment signal is the `Route Assigned` column == `"Assigned"` (exact match) — NOT `Status`**, which stays `Pending`/`Re-scheduled` even after routing. Beware: `"Unassigned"` contains the substring `"assigned"`, so match exactly (`/^assigned$/i`), never a substring. Compute "soonest future job where Route Assigned == Assigned". This is a per-customer scrape (no bulk source), and it's the input the `/service/overdue` row-coloring "48h rescue" hook in `overdue-view.tsx::rowToneClass()` is waiting on. Probes: `scripts/probe-scheduled-services.ts`, `scripts/probe-scheduled-scan.ts`.

6. **Customer deactivation date + reason are NOT in the JWT API (probe-confirmed 2026-06-16, scrape-only).** Verified on active + inactive customers across all three JWT surfaces (customer list = 9 skinny fields; `GET /jwt/office/{office}/customer/{id}` = profile/state/addresses but only `status`; `/contracts` = `date_cancelled`/`sales_status_modified` null/unreliable for inactive). The customer-level **"Customer Deactivation Date"** and **deactivation Reason** live only in the web UI: the "Update Account Status" modal `GET /customer/{id}/deactivate?contractid={cid}` is a *write* form (selects don't echo current values) and exposes the **vocabularies** — Cancel Reasons (`activation[statusReason]`: Bad Debit, Bad Sale, Can't Reach, Competitor, DIY, Duplicate, Financial, Moved, Out of Service Area, Personal Reason, Results, Results - SL) and Sales Statuses (`activation[salesStatus]`: Pending, Initial Job Complete, Cancelled Customer, Cancelled - Do Not Contact, Cancelled - Moved). The recorded **Sales Status IS scrapeable** from `/customer/{id}/service-information` as a description-list pair (`<dt>Sales status</dt><dd>…</dd>`, contract-scoped). Consequence: **"Cancelled – This Year" (by true deactivation date) and a cancelled-by-reason breakdown remain UNBUILT** — they need a per-customer scrape job (mirror the inactive-enrichment cron). The current taxonomy (§ Sales) uses the tag-based "Not Renewed" carve + last-service-year breakdown as the available proxy. Probes: `scripts/probe-deactivation-fields.ts`, `probe-deact-modal.ts`, `probe-deact-dtdd.ts`, `probe-inactive-deact.ts`.

7. **No route CODE anywhere in Pocomos (probe-confirmed 2026-07-07) — `/service/overdue` "Route" column DEFERRED.** Probed for a route/map code across the cheap-to-expensive sources: `/customers/data` has **no** route column (headers are only Sign-up / Last Service / Next Service; row keys are `0–9 + id/is_parent/is_child/multiple_contracts/commercial_account`); `service-information` has no route field (its "Route:" strings are JS `Pocomos.router` noise); the per-customer `scheduled-services` page's **"Route Assigned"** column is an assignment **status** (`"Unassigned"` in the sample), not a route name/code, and the Technician column read `"None"`. So there is **no bulk (or even cheap) source for a route code** — the requested Route column has nothing to display. Deferred pending an ops decision (BACKLOG). If we want *assignment* status instead of a code, it's the same per-customer `scheduled-services` scrape as open #5 (Assigned/Unassigned + technician), which would materially slow the daily refresh (a scrape of all ~1,146 eligible vs today's ~21% add-on-only). Probe: `scripts/probe-builds.ts` (removed after use).

8. **`/sales` return rate — mid-season-cancel denominator is a PENDING ops decision (§5.8).** The card computes BOTH a primary rate (all real {from} customers in the denominator) and an excl-mid-season rate (mid-season {from} cancels removed). Which is canonical — i.e. should a customer who signed up for a season but cancelled mid-season count against that season's return rate — is unresolved (Rivka/Leon). Until decided, both are shown. Also open: the "real customer" validation currently uses `inactive + last completed service in year Y` as the mid-season-cancel signal; if a true per-customer deactivation-date scrape lands (open #6), swap it in for a sharper cutoff.

### Fallback if the web back-door breaks

The web back-door (Surface B) is the load-bearing piece for the lead sync. If Pocomos changes the form, the CSRF scheme, the `/leads/data` schema, or the session cookie name, the sync silently empties out. Mitigations:
- `webSession.ts` re-logs on `{"type":"redirect","redirect":"/login"}` and surfaces a clear error if even the re-login fails.
- The `phoneburner_contacts` watermark table means even if a sync misses a window, the next successful run picks up everything since `last_sync_at` — no gaps.
- Last-resort fallback is the same as before: nightly CSV export → `inbound_leads` Neon table → sync reads from Neon.

---

## 10. People & Permissions

- **Ohavia Feldman** — owner, builder, Anthropic principal
- **Rivka Leyton** — operations, gives bucket-logic feedback
- **Leon Lantsman** — stakeholder
- **Rena** — CSR / dialer user
- **David Tribe** — Pocomos support, set up the API user

---

## 11. Quick Commands

```bash
# Pull latest env vars
vercel env pull .env.local

# Run probe scripts locally
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-pocomos-leads.ts

# Trigger a cron manually
curl https://ms-operations-hub.vercel.app/api/cron/snapshot

# Read last N snapshots
curl https://ms-operations-hub.vercel.app/api/snapshots?limit=7
```

### 11.1 Command hygiene (PowerShell on Windows) — avoids approval prompts

The working agreement lives in `CLAUDE.md` (repo root); the load-bearing rules:

- **Commit messages:** `git commit -m "short single line"`, OR a message file in the **project root** (`git commit -F msg.txt`, then delete it). **Never** write into `.git\`.
- **Vercel CLI:** call via `npx vercel` or a resolved PATH string — never `& "$env:APPDATA\npm\vercel.cmd"` (the `.ps1`/`.cmd` shim call-operator form trips the sandbox).
- **No** `$(...)` subexpressions, **no** `Set-Location "...";&` wrappers, and **no** output redirect/re-read on commands (`> file; Get-Content`, `Select-String`, `Select-Object -Skip/-First` piped from a command). Put any verification in a `.ts` script run as one plain `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/<x>.ts` that logs only what's needed.
- Assume you're already in the project directory; call `node`/`git`/`npm`/`vercel` directly.
- npm-global CLIs: invoke the `.cmd` (e.g. `npx vercel`); the `.ps1` shim is blocked by execution policy.

---

## 12. Complete Pocomos API Catalog

This is the **full inventory** of every Pocomos API endpoint, captured from a Postman dump where every endpoint and its curl example was pasted. Treat this as the master list — if you need to do something with Pocomos, check here first before guessing a path.

> ⚠️ Captured before the tags GET endpoint was added. The note at the bottom about tags being "write-only" was true *at capture time*; we now have a tags GET endpoint that works for contracts. Whether it works for leads is unresolved — see Section 9.

### Base URL & Auth

- **Base:** `https://mypocomos.net`
- **Auth header on every data call:** `XauthToken: {JWT}` (NOT `Authorization: Bearer`)
- **Token endpoint:** `POST /public/technician/jwt_token` (x-www-form-urlencoded body with `username` and `password`)
- **Token field in response:** `body.response` (not `body.token` or `body.jwt`)

### Office / Reference Data

```
GET  /jwt/pronexis/{office}/office/show
GET  /jwt/pronexis/{office}/agreements
GET  /jwt/pronexis/{office}/zipcodes
GET  /jwt/pronexis/{office}/discounts
GET  /jwt/pronexis/tags/list/{office}                 ← tag DICTIONARY (id→name); this is the path in code (tags.ts)
GET  /jwt/pronexis/{office}/pests/targets
GET  /jwt/pronexis/{office}/pests/specialty
GET  /jwt/pronexis/{office}/salespersons
GET  /jwt/pronexis/{office}/tech/availability?start-date=&end-date=&service-id=
GET  /jwt/pronexis/customer/list/{office}/taxcodes
GET  /jwt/pronexis/customer/{office}/show/agreement/{agreementId}
```

### Customers

```
GET  /jwt/pronexis/customer/list/{office}
     → Returns: id, firstName, lastName, PHONE, EMAIL, postalCode, status,
       lastServiceDate, nextServiceDate. NO tags.
     → Returns ALL customers system-wide (~3,730), not just one office.
     → Filter client-side on status.

POST /jwt/pronexis/{office}/customer/search
     Body (form-data): searchTerm
     → Returns full customer profile. Still NO tags.

POST /jwt/pronexis/{office}/customer/create?lead_id={lead_id}
     → Creates customer + contract from a lead (the conversion path).

GET  /jwt/pronexis/{office}/customer/{customer}/contracts
     → Returns contracts array. Each contract has pest_contract nested
       (service_type, service_frequency). NO tags field inline.

POST /jwt/pronexis/{office}/customer/{customer}/contract/create
     Body includes: "tags": [tagId]   ← tags CAN be SET here on contract creation
     → Creates a new contract for an existing customer.

POST /jwt/pronexis/{office}/customer/{customer}/accounts/create
     Body example: {
       "account": {
         "alias": "from postman",
         "paymentMethod": "card",
         "accountNumber": "4242 4242 4242 4242",
         "expiryMonth": "12",
         "expiryYear": "2030"
       }
     }
     → Adds a payment method to a customer.

POST /jwt/pronexis/{office}/customer/{customer}/note/create
     Body example: {
       "note": {
         "interactionType": "Other",
         "summary": "Text of the Note",
         "displayOnWorkorder": true,
         "favorite": true,
         "displayOnLoad": false,
         "displayOnRouteMap": false,
         "showOnTechApp": false
       }
     }
     → Writes an account note. THIS IS THE ENDPOINT THE WEBHOOK USES.

POST /jwt/pronexis/{office}/customer/{customer}/charge/create
     Body example: {
       "pay_what": "payment",
       "receivemoney": {
         "newPayment": "1",
         "invoices": ["18601321"],
         "method": "Cash",
         "account": "3518170",
         "description": "test",
         "amount": "576.00"
       },
       "omitFlash": "true"
     }
     → Posts a payment / charge.
```

### Leads

> **UPDATE (2026-06-16): the richer lead read DOES exist — it's the web back-door, not a JWT path.** The JWT lead endpoints below are shallow, but full lead data (phone, email, `date_added`, salesperson, status **including converted "Customer" leads**) is reachable and IN PRODUCTION via the Symfony web session:
> - `POST /leads/data` (legacy DataTables 1.9 body, `statuses[]=Lead`) → open leads with phone/email/date. Used by `leadSync.ts`.
> - **Advanced Search two-step feed** → ALL statuses incl. converted: register `search[leadStatus][]` for all five statuses at `/leads/advanced-search/show` + `/leads/lead-advanced-search`, then page `/lead/lead-advanced-search/data`. Used by `closeRate.ts` (§5.6). See §9 Resolved #11.
>
> Still no API path for a given lead's **tag chips** (§9 open #1) — lead routing is age-based instead.

```
GET  /jwt/{office}/lead/list?limit=50&offset=0
     → Paginated lead list. NOTE the path uses /jwt/{office}/ — NOT /jwt/pronexis/.
     → Probe confirmed (5/14): returns id, company_name, first_name, last_name,
       status.value, reason, contact_address, quote.found_by_type.
     → Shallow: NO phone, email, or created date here. For those, use the web
       back-door POST /leads/data / Advanced Search feed (see callout above).

GET  /jwt/{office}/lead/{lead}
     → Single lead detail. Probe confirmed (5/14): returns same shallow fields
       as the list. NO phone, email, or date — again, use the web back-door.

POST /jwt/pronexis/customer/save-lead/{office}
     Body example: {
       "firstName": "Name", "lastName": "Postman",
       "companyName": "Please Ignore",
       "contactAddress": {
         "street": "Test St", "city": "Test City", "region": "1834",
         "postalCode": "84660", "phone": "1234567899"
       },
       "emailAddress": "tst@tst.local",
       "accountType": "Residential",
       "billingAddressSame": "1",
       "status": "Lead",
       "quote": { "salesperson": "177688", "foundByType": "404" },
       "note":  { "summary": "Initial job note" },
       "notes": { "summary": "Account note visible on lead" }
     }
     → Creates a lead. This is the only Pocomos write that confirms leads CAN
       hold phone, email, and marketing source — we just can't read them back
       via the documented GET endpoints yet.

PUT  /jwt/{office}/lead/{lead}
     Body: same shape as save-lead
     → Updates a lead.
```

### Tags (added after the catalog was captured)

```
GET /jwt/pronexis/tags/list/{office}
    → Office tag DICTIONARY (id → name). Working; used by tags.ts to resolve
      bare tag ids on customers/contracts.

GET /jwt/office/{office}/contract/{pestContractId}/tags
    → Returns tags for a specific CONTRACT. Works (proven in customers table
      enrichment; used by contract-tags.ts).
    → Does NOT accept ?lead_id= query param (probe disproved this 5/14).
    → Still no working path for a given LEAD's tag chips (§9 open #1). NOTE this
      is only about tag chips — lead status/phone/email/date ARE readable via the
      web back-door + Advanced Search feed (§9 Resolved #11).
```

### Endpoint inventory at a glance

| Category | Verbs available | Tags-readable? |
|---|---|---|
| Office reference data (agreements, ZIPs, pests, etc.) | GET | n/a |
| Customers — list, search, create, contracts, notes, accounts, charges | GET + POST | YES (via tags endpoint) |
| Contracts — create | POST | tags settable, readable per contract |
| Leads — list, get, create, update | GET + POST + PUT | UNRESOLVED |
| Auth | POST | n/a |

### What's NOT in the catalog (confirmed gaps)

- No outbound webhooks from Pocomos — we poll
- No dedicated "log a call" endpoint — we use `note/create` as the destination for PhoneBurner dispositions
- No read endpoint for a given lead's **tag chips** (age-based routing shipped instead — §9 open #1)
- No `phone` / `email` / `created_at` on the *JWT* lead GET endpoints — but the **web back-door** `POST /leads/data` + Advanced Search feed DO return them (§9 Resolved #11), so this is no longer a real blocker
- No bulk endpoint for "all contracts in the office" — must iterate per customer

### Key insight from this catalog

The customer list endpoint **does** return phone and email natively, and the richer **lead** read turned out to exist too — not as a JWT endpoint, but through the Symfony web session (`POST /leads/data` for open leads, the Advanced Search two-step feed for all statuses incl. converted). Both are shipped and in production (§9 Resolved #11). The only lead field still unreadable via any path is a lead's tag chips. The asymmetry was never fundamental — just JWT-surface-only.

---

## 13. Glossary

- **Office** — A Pocomos tenant. We are office `1512`.
- **Pronexis** — A Pocomos internal product line / path segment for customer endpoints. Not all paths use it.
- **pestContractId** — The Pocomos internal ID of a pest control contract. Tags hang off this for customers.
- **URL ID** vs. **Customer ID** — internal vs. user-facing customer identifier. Always convert before writing notes.
- **Bucket** — A dashboard category: NEW, RETURNING, RETAINED, AT_RISK, CANCELLED.
- **Folder** / **Category** — PhoneBurner's grouping for contacts. We use folder ID `category_id` interchangeably.
- **Disposition** — The outcome a CSR marks at the end of a PhoneBurner call (Booked, Left VM, etc.).
- **Watermark** — The "last successful sync" timestamp used to fetch only new records.

---

*End of reference. Update this file as endpoints, tag values, or routing logic change.*
