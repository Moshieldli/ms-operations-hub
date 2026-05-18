# MS Operations Hub — Master Reference

**Last updated:** May 18, 2026 (rev 5 — synced doc with shipped reality per commit fe1f12d. Marked PhoneBurner sync (cron, age-based folder routing, two-custom-field write) as LIVE rather than planned; replaced the speculative §6 file tree with the files that actually shipped; updated §4 webhook field-name bullets against the real Call End payload; moved webhook field-name reverse-engineering and several integration-quirk items from §9 OPEN to RESOLVED. No factual changes to API auth, payload shapes, or routing decisions — rev 4 was already correct on those.)
**Project:** MS Analytics — Mosquito Shield of Long Island (Progranic LLC)
**Office ID:** 1512
**Live URL:** https://ms-operations-hub.vercel.app
**GitHub:** github.com/Moshieldli/ms-operations-hub
**Local path:** `C:\Users\OhaviaFeldman\Desktop\ms-operations-hub\`

This document is the single source of truth for how Pocomos and PhoneBurner connect through the MS Operations Hub. Paste it into any new Claude chat or feed it to Claude Code when you need full context.

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

### Tag values used in routing/categorization

| Tag | Meaning | Used for |
|---|---|---|
| `2026 - New Sale` | Customer signed in 2026 | NEW / RETURNING bucket |
| `2026 - Auto` | Auto-renewed | RETAINED — Auto |
| `2026 - SEB` | Service Email Booking | RETAINED — SEB |
| `2026 - EB` | Email Booking | RETAINED — EB |
| `2025 - New Sale`, `2024 - ...` etc. | Historical year tags | Distinguish RETURNING vs. NEW |
| `L - Competitor` | Lead competing with another company | PhoneBurner folder 66223882 |
| `L - Financial` | Lead has price/financial concerns | PhoneBurner folder 66223883 |
| `L - DNC` | Do not call | Exclude from PhoneBurner sync |
| `NT - No Marketing` | Don't market to this lead | Exclude from PhoneBurner sync |

**Bucket logic (current implementation):**
- **NEW** = has `2026 - New Sale` AND has no prior YYYY tag
- **RETURNING** = has `2026 - New Sale` AND has any prior YYYY tag
- **RETAINED — Auto / SEB / EB** = has matching `2026 - {Auto|SEB|EB}` tag
- **AT_RISK** = active customer with no current-year tag
- **CANCELLED** = status `Inactive`
- **`2026 - Renewed` does NOT exist** — earlier code that looked for it was wrong, per Rivka.

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

Two endpoints in the `ms-operations-hub` Vercel project handle the entire flow.

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

**Phase B — conversionCleanup (Pocomos → PhoneBurner, status changes on existing contacts)**

1. Query `phoneburner_contacts` for rows in folders `66223880`, `66223881`, `66223882`, `66223883`, `66223884`, `66223885`, `66223886`, `66223887`, `66223888` (leads + cancelled).
2. For each, look up the current Pocomos status:
   - **Lead → Customer (active):** `PUT /contacts/{pb_id}` to set `category_id = 66233602` (Active Customer); update `phoneburner_contacts.folder_id`, `last_updated_at`; write a Pocomos note `Moved out of PhoneBurner outbound — now Active`.
   - **Cancelled → Active:** same as above.
   - **No conversion AND `last_notes_refresh_at > 24h ago`:** pull current Pocomos notes (skip `source='pb'`), re-format using the same 10-most-recent rule, `PUT /contacts/{pb_id}` to update the `notes` field, set `last_notes_refresh_at = NOW()`.
3. Returns `{ moved, refreshed_notes, checked, errors, duration_ms }`.

**Combined result returned by the route:**
```jsonc
{
  "leadSync": { "added": N, "skipped_dup": N, "skipped_nophone": N, "errors": [], "duration_ms": N },
  "conversionCleanup": { "moved": N, "refreshed_notes": N, "checked": N, "errors": [], "duration_ms": N }
}
```

**Cron config in `vercel.json`** (LIVE since 2026-05-15):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/snapshot", "schedule": "0 5 * * *" },
    { "path": "/api/phoneburner/sync-leads", "schedule": "*/15 * * * *" }
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
- Refreshed **lazily** during `conversionCleanup`, but only when `last_notes_refresh_at > 24 hours ago` for that contact. The 24h floor exists to keep the cleanup pass cheap — most leads don't add 50 notes a day, and PhoneBurner's `notes` field doesn't render in real time anyway.
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

## 6. File Structure (shipped)

```
src/
├── lib/
│   ├── db.ts                          ← Neon client, initSchema, getSyncState/setSyncState
│   ├── snapshots.ts                   ← writeSnapshot, listSnapshots
│   ├── enrichment.ts                  ← enrichInactiveCustomers (overnight)
│   ├── pocomos/
│   │   ├── webSession.ts              ← PHPSESSID cache, Symfony login, postSessioned helper (Surface B/C bootstrap)
│   │   ├── notes.ts                   ← getNotesForLead, formatNotesForPhoneBurner (JSON-first, HTML fallback)
│   │   ├── client.ts                  ← JWT API wrapper (Surface A)
│   │   ├── auth.ts                    ← JWT token mint + cache
│   │   ├── categorize.ts              ← bucket logic (NEW / RETURNING / RETAINED / AT_RISK / CANCELLED)
│   │   ├── types.ts
│   │   └── interactionTypes.ts        ← probes accepted `interactionType` values for customer note/create
│   ├── phoneburner/
│   │   ├── client.ts                  ← createContact, listContactsInFolder, normalizePhone
│   │   └── folders.ts                 ← FOLDERS constant (LEADS_FRESH, LEADS_GENERAL, ACTIVE_CUSTOMER, …)
│   └── sync/
│       ├── leadSync.ts                ← Phase A: Pocomos → PhoneBurner, age-based folder routing, watermark advance
│       ├── conversionCleanup.ts       ← Phase B: status-change folder moves + lazy notes refresh
│       └── webhookProcessor.ts        ← PB webhook payload parser (status, recording_url_public, agent, contact.notes)
└── app/
    ├── api/
    │   ├── cron/snapshot/route.ts     ← daily 05:00 ET snapshot
    │   ├── snapshots/route.ts         ← snapshot read endpoint
    │   └── phoneburner/
    │       ├── sync-leads/route.ts    ← runs Phase A + Phase B in sequence
    │       └── webhook/route.ts       ← `api_calldone` receiver, writes Pocomos note via waitUntil
    └── phoneburner/page.tsx           ← status page
```

The old plan listed `sync/state.ts` and `sync/leadRouter.ts`; neither ended up as its own file. State (watermarks) lives in `lib/db.ts` via `getSyncState`/`setSyncState`, and routing is inline in `leadSync.ts`. The `pocomos/` directory has additional files outside the PhoneBurner integration story (`customers.ts`, `tags.ts`, `contracts.ts`, `pool.ts`, `contract-tags.ts`, `dataset.ts`, `sales-provider.ts`, `index.ts`) that drive `/sales` and the daily snapshot — they're not listed because they're not part of the PhoneBurner flow this document covers.

---

## 7. Database — Neon Postgres (already live)

Provisioned via Vercel Marketplace as `neon-indigo-dog`. Auto-wired env vars.

### Existing tables

**`snapshots`** — one row per Eastern calendar date, UPSERTed by the daily cron.
Columns: `id, snapshot_date, active_count, services_count, new_count, returning_count, retained_count, retained_auto, retained_seb, retained_eb, at_risk_count, cancelled_count, cancelled_2026, cancelled_2025, cancelled_2024, cancelled_2023, cancelled_2022, cancelled_2021, on_hold_count, untagged_count, raw_json (jsonb)`

**`customers`** — enriched non-active customers (Inactive + On-Hold), 2,674 rows as of 5/14.
Populated by the resumable `enrichInactiveCustomers({ budgetMs, maxCustomers })` job that skips IDs already at `depth='full'` via a `refreshed_at` watermark.

### Tables to add for PhoneBurner

**`sync_state`** — single-row table holding watermarks.
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
  received_at TIMESTAMPTZ DEFAULT NOW(),
  pocomos_id TEXT,
  disposition TEXT,
  csr_name TEXT,
  note_written BOOLEAN,
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

### Still open

1. **Lead-tag read endpoint.** No working API path for reading lead tags; tag-based routing is deferred. Possible v2 paths:
   - The `marketing_type_name` field on `/leads/data` may proxy for the routing decision (e.g., a "Competitor switch" marketing type → folder `66223882`).
   - Pocomos may add a lead-tags read endpoint.
   - Scrape `/lead/{id}/lead-information` HTML for the tag chips.
   - **TODO when a working source lands:** route `L - Competitor` → `66223882`, `L - Financial` → `66223883`, skip `NT - No Marketing` and `L - DNC`.

2. **`conversionCleanup` batching performance.** The cleanup pass walks every row of `phoneburner_contacts` in lead/cancelled folders on every cron tick. Fine today; expected to bite around ~3k tracked rows. Plan: batch by `last_updated_at` ascending and cap rows-per-tick.

3. **Real-time Pocomos → PhoneBurner notes refresh.** PB-side notes are refreshed lazily by `conversionCleanup` only when `last_notes_refresh_at > 24h ago`. A CSR opening a contact within that window sees stale notes. Real-time refresh would require either a Pocomos→hub webhook (Pocomos has no outbound webhooks — §12) or an on-demand "refresh now" link from the dialer.

4. **Active-customer upsell sync.** Customer No Add-Ons folder (`66229452`) was removed from PB on 2026-05-15 along with the v1 plan to feed active customers without renewal/upsell contracts into a follow-up bucket. Deferred until product decides what the upsell motion actually looks like.

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
GET  /jwt/pronexis/{office}/tags                      ← tag DEFINITIONS only (catalog)
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

```
GET  /jwt/{office}/lead/list?limit=50&offset=0
     → Paginated lead list. NOTE the path uses /jwt/{office}/ — NOT /jwt/pronexis/.
     → Probe confirmed (5/14): returns id, company_name, first_name, last_name,
       status.value, reason, contact_address, quote.found_by_type.
     → DOES NOT include phone, email, or created date in the response.

GET  /jwt/{office}/lead/{lead}
     → Single lead detail. Probe confirmed (5/14): returns same shallow fields
       as the list. NO phone, email, or date. Open question whether a richer
       endpoint exists.

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
GET /jwt/office/{office}/contract/{pestContractId}/tags
    → Returns tags for a specific contract. Works (proven in customers table
      enrichment).
    → Does NOT accept ?lead_id= query param (probe disproved this 5/14).
    → No working path found yet for reading lead tags.
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
- No read endpoint for lead tags found yet
- No `phone` / `email` / `created_at` in the documented lead GET endpoints (despite leads accepting these on CREATE)
- No bulk endpoint for "all contracts in the office" — must iterate per customer

### Key insight from this catalog

The customer list endpoint **does** return phone and email natively. This means Pocomos *can* expose contact data via API — it just doesn't on the lead endpoints. That's an asymmetry, not a fundamental limitation. The richer lead read endpoint may exist; we just haven't found the right path yet.

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
