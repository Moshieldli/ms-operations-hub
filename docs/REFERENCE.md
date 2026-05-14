# MS Operations Hub — Master Reference

**Last updated:** May 14, 2026 (rev 2 — added complete API catalog from prior chat, corrected tags endpoint, updated probe findings)
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
| `66223882` | **Leads — Competitor** | Leads tagged `L - Competitor` |
| `66223883` | **Leads — Financial** | Leads tagged `L - Financial` |
| `66223884` | **Cancelled — Competitor Win-Back** | Former customers, cancelled for competitor |
| `66223885` | **Cancelled — Financial/Price** | Former customers, cancelled over price |
| `66223886` | **Cancelled — Results Issues** | Former customers, cancelled over service results |
| `66223887` | **Cancelled — Could Not Reach** | Former customers we couldn't reach |
| `66223888` | **Cancelled — Personal/Other** | Former customers, other reasons |

**How we link back to Pocomos from a PhoneBurner contact:**
- `custom_fields: [{ name: "Customer ID", type: 1, value: lead_id_or_customer_id }]` — stores the Pocomos ID
- `website: https://mypocomos.net/lead/{lead_id}/lead-information` (for leads) — one-click jump to the record

**Excluded from sync:** Leads tagged `NT - No Marketing` or `L - DNC` (Do Not Call) are never pushed to PhoneBurner.

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

```http
POST /contacts
Body: {
  first_name, last_name, raw_phone,
  email_address, address1, city, state, zip,
  notes, website,
  category_id: "66223880",                                  // folder
  custom_fields: [{ name: "Customer ID", type: 1, value: "154427" }]
}
→ Create a contact in a folder.

GET /contacts?category_id={folder}&page=1&page_size=500
→ List contacts in a folder. Use for dedup checks.
  Response: { contacts: { contacts: [...], total_results: N, next_page: ... } }

PUT /contacts/{user_id}
→ Update a contact (move folders, change custom_fields, add notes, etc.)

GET /contacts/categories
→ List all folders with IDs and names. Useful for sanity-checking folder IDs.
```

### Webhook event

PhoneBurner fires `api_calldone` after every call. We receive it at:

```
POST /api/phoneburner/webhook?secret={WEBHOOK_SECRET}
```

Setup in PhoneBurner UI: Settings → API Webhooks → Add Webhook → Event `api_calldone`, URL above.

**Payload fields we use** (verify exact names against PB docs at build time):
- `status` (the disposition: Booked, Left VM, No Answer, Not Interested, etc.)
- `duration`
- `call_recording_url`
- `contact.user_id`
- `contact.custom_fields` — pull `Customer ID` from here to find the Pocomos record
- `notes` (CSR-typed notes)

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

**Flow:**

1. Get cached JWT (refresh if >50 min old)
2. Read `last_sync_at` watermark from storage (Neon Postgres recommended — table `sync_state`)
3. `GET /jwt/1512/lead/list?limit=200&offset=0` and paginate
4. Filter to leads where:
   - `status.value === 'Lead'`
   - `created_at > last_sync_at` (field name to be confirmed via probe)
5. For each lead, fetch tags: `GET /jwt/office/1512/contract/{x}/tags?lead_id={lead_id}`
6. Skip if tagged `NT - No Marketing` or `L - DNC`
7. Route to folder:
   - `L - Competitor` → 66223882
   - `L - Financial` → 66223883
   - default → 66223880 (Fresh)
8. Check PhoneBurner for existing contact by phone match — skip if exists
9. `POST /contacts` with all fields plus `custom_fields: [{ name: "Customer ID", type: 1, value: lead_id }]` and `website` linking back to Pocomos
10. Update watermark to current timestamp
11. Log `{ added, skipped, errors, duration_ms }`

**Cron config in `vercel.json`:**
```json
{
  "crons": [
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

---

## 6. File Structure (target)

```
src/
├── lib/
│   ├── db.ts                          ← Neon client, initSchema (exists)
│   ├── snapshots.ts                   ← writeSnapshot, listSnapshots (exists)
│   ├── enrichment.ts                  ← enrichInactiveCustomers (exists)
│   ├── pocomos/                       ← Pocomos client (exists)
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── categorize.ts
│   │   └── types.ts
│   ├── phoneburner/                   ← NEW
│   │   ├── client.ts                  ← API wrapper
│   │   ├── contacts.ts                ← create/update/list/dedup
│   │   ├── folders.ts                 ← FOLDERS constant + helpers
│   │   └── types.ts
│   └── sync/                          ← NEW
│       ├── state.ts                   ← last_sync_at storage
│       ├── leadRouter.ts              ← tag → folder logic
│       └── webhookProcessor.ts        ← disposition → Pocomos note
└── app/
    ├── api/
    │   ├── cron/snapshot/route.ts     ← existing daily snapshot
    │   ├── snapshots/route.ts         ← existing read endpoint
    │   └── phoneburner/               ← NEW
    │       ├── sync-leads/route.ts
    │       └── webhook/route.ts
    └── phoneburner/page.tsx           ← NEW status page
```

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

**`phoneburner_contacts`** — maps Pocomos IDs to PhoneBurner contact IDs to prevent duplicates.
```sql
CREATE TABLE phoneburner_contacts (
  pocomos_id TEXT PRIMARY KEY,
  pocomos_type TEXT CHECK (pocomos_type IN ('lead', 'customer')),
  pb_contact_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ
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

Status as of May 14, 2026 — after the first round of probes.

1. **Lead GET endpoints are shallow.** Probe (5/14) confirmed `GET /jwt/1512/lead/{lead_id}` returns the same fields as the list: `id, company_name, first_name, last_name, status.value, reason, contact_address, quote.found_by_type`. **No phone, email, or created date.** Yet `POST /jwt/pronexis/customer/save-lead/{office}` accepts phone/email/marketing source — proving the data exists in Pocomos. There must be a richer read path. **Probing in progress** for `?include=`, `?expand=*`, POST search, and `contact_address.id` resolution.

2. **Tag-based folder routing for leads has no working endpoint.** Tags endpoint with `?lead_id=` rejected with 400 / 404 across all variants. We don't know if leads even have tags via API (only confirmed via CSV exports). Worth confirming with Rivka whether `L - Competitor` / `L - Financial` tags live on leads or only on customers/contracts.

3. **Lead-note write path unverified** — `POST /jwt/1512/lead/{lead_id}/note` is best guess; not yet tested against production.

4. **PhoneBurner webhook payload field names** — verify exact names against PB docs at build time; common ones expected (`status`, `duration`, `contact.custom_fields`).

5. **Conversion handling** — when a Pocomos lead converts to a customer (via `POST /jwt/pronexis/{office}/customer/create?lead_id={lead_id}`), what should happen to the PhoneBurner contact? Currently undecided. Phase 2.

### Fallback if lead read endpoint stays shallow

If further probes fail to find phone/date on leads via API, the fallback is a nightly CSV export from Pocomos UI (manual or automated via headless browser) that feeds an `inbound_leads` table in Neon. Sync then reads from Neon, not Pocomos directly. Hacky but proven — that's how the historical lead import already worked.

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
