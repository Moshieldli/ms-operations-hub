/**
 * short_id → pocomos web id map (rev 18).
 *
 * WHY THIS EXISTS: both bulk exports key on the 6-digit "Customer Id" /
 * "CustomerNumber" (the SAME id space — verified: Eli Fogel = 150428 in both).
 * Everything else in this app keys on the 7-digit Pocomos *web* id. Pocomos
 * exposes NO short id on any surface we can read: the JWT customer-list returns
 * only {id, firstName, lastName, phone, emailAddress, postalCode, status,
 * lastServiceDate, nextServiceDate}, and neither bulk web source carries it
 * either. So the map is built by matching CONTACT DETAILS, strongest key first:
 *
 *   1. email (unique hit)            → confidence "high"
 *   2. email (several hits) + last name / phone / zip tie-break → "high"
 *   3. phone (unique hit)            → "high"
 *   4. first+last name (unique hit)  → "medium"
 *   5. last name + zip (unique hit)  → "low"
 *
 * Anything still ambiguous or unmatched is REPORTED, never guessed — an
 * unmapped short id means that customer's export jobs are dropped, which we'd
 * rather see in the coverage number than silently mis-attribute.
 *
 * Households legitimately share an email/phone (two Pocomos records, one
 * address), which is why a multi-hit email falls through to a tie-break rather
 * than being treated as a failure.
 */
import { sql } from "@/lib/db";
import { fetchAllCustomers } from "@/lib/pocomos/customers";
import { normEmail, normName, normPhone, normZip } from "./exportCsv";

export interface ExportContact {
  shortId: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  zip: string;
}

export interface IdMapEntry {
  shortId: string;
  pocomosId: string;
  method: string;
  confidence: "high" | "medium" | "low";
  matchedOn: string;
}

export interface IdMapResult {
  entries: IdMapEntry[];
  /** short ids we could not resolve to exactly one web id. */
  unresolved: Array<{ shortId: string; reason: string; contact: ExportContact }>;
  byMethod: Record<string, number>;
  apiCustomers: number;
}

interface ApiCust {
  id: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  zip: string;
  /** Lowercased Pocomos status — used to prefer a live record over a dead duplicate. */
  status: string;
  /** ISO-ish last service date ("" if none) — recency tie-break of last resort. */
  lastService: string;
}

/** Build the map for a set of export contacts against the live customer list. */
export async function buildIdMap(contacts: ExportContact[]): Promise<IdMapResult> {
  const raw = (await fetchAllCustomers()) as Array<Record<string, unknown>>;
  const api: ApiCust[] = raw.map((c) => ({
    id: String(c.id),
    first: normName(c.firstName),
    last: normName(c.lastName),
    email: normEmail(c.emailAddress),
    phone: normPhone(c.phone),
    zip: normZip(c.postalCode),
    status: String((c.status as { name?: string })?.name ?? c.status ?? "").toLowerCase(),
    lastService: String(c.lastServiceDate ?? "").slice(0, 10),
  }));

  const idx = (key: (c: ApiCust) => string) => {
    const m = new Map<string, ApiCust[]>();
    for (const c of api) {
      const k = key(c);
      if (!k) continue;
      m.set(k, [...(m.get(k) || []), c]);
    }
    return m;
  };
  const byEmail = idx((c) => c.email);
  const byPhone = idx((c) => (c.phone.length === 10 ? c.phone : ""));
  const byFullName = idx((c) => (c.first && c.last ? `${c.first}|${c.last}` : ""));
  const byLastZip = idx((c) => (c.last && c.zip ? `${c.last}|${c.zip}` : ""));

  const entries: IdMapEntry[] = [];
  const unresolved: IdMapResult["unresolved"] = [];
  const byMethod: Record<string, number> = {};
  const bump = (m: string) => (byMethod[m] = (byMethod[m] || 0) + 1);

  /** Narrow several same-email/phone hits down to one using name → phone → zip. */
  const tieBreak = (hits: ApiCust[], k: ExportContact): ApiCust | null => {
    const last = normName(k.last);
    const first = normName(k.first);
    let pool = hits;
    if (last) {
      const byLast = pool.filter((c) => c.last === last);
      if (byLast.length === 1) return byLast[0];
      if (byLast.length) pool = byLast;
    }
    if (first) {
      const byFirst = pool.filter((c) => c.first === first);
      if (byFirst.length === 1) return byFirst[0];
      if (byFirst.length) pool = byFirst;
    }
    const ph = normPhone(k.phone);
    if (ph.length === 10) {
      const byPh = pool.filter((c) => c.phone === ph);
      if (byPh.length === 1) return byPh[0];
      if (byPh.length) pool = byPh;
    }
    const z = normZip(k.zip);
    if (z) {
      const byZ = pool.filter((c) => c.zip === z);
      if (byZ.length === 1) return byZ[0];
      if (byZ.length) pool = byZ;
    }
    // Still tied → these are DUPLICATE RECORDS of one human (same email AND
    // name/phone/zip). Pocomos spawns a fresh customer record on lead conversion
    // rather than reusing the old one, so duplicates are expected and both refer
    // to the same person. Prefer the live record, then the most recently
    // serviced — that's the one the rest of the app (dataset, tags, cohort)
    // will also be reasoning about.
    if (pool.length > 1) {
      const active = pool.filter((c) => c.status === "active");
      if (active.length === 1) return active[0];
      const rank = (active.length ? active : pool)
        .slice()
        .sort((a, b) => b.lastService.localeCompare(a.lastService));
      if (rank.length && rank[0].lastService && rank[0].lastService !== rank[1]?.lastService)
        return rank[0];
    }
    return null;
  };

  for (const k of contacts) {
    const email = normEmail(k.email);
    const phone = normPhone(k.phone);

    const eHits = email ? byEmail.get(email) : undefined;
    if (eHits?.length === 1) {
      entries.push({ shortId: k.shortId, pocomosId: eHits[0].id, method: "email", confidence: "high", matchedOn: email });
      bump("email");
      continue;
    }
    if (eHits && eHits.length > 1) {
      const win = tieBreak(eHits, k);
      if (win) {
        entries.push({ shortId: k.shortId, pocomosId: win.id, method: "email+tiebreak", confidence: "high", matchedOn: email });
        bump("email+tiebreak");
        continue;
      }
    }

    const pHits = phone.length === 10 ? byPhone.get(phone) : undefined;
    if (pHits?.length === 1) {
      entries.push({ shortId: k.shortId, pocomosId: pHits[0].id, method: "phone", confidence: "high", matchedOn: phone });
      bump("phone");
      continue;
    }
    if (pHits && pHits.length > 1) {
      const win = tieBreak(pHits, k);
      if (win) {
        entries.push({ shortId: k.shortId, pocomosId: win.id, method: "phone+tiebreak", confidence: "high", matchedOn: phone });
        bump("phone+tiebreak");
        continue;
      }
    }

    const nKey = `${normName(k.first)}|${normName(k.last)}`;
    const nHits = normName(k.first) && normName(k.last) ? byFullName.get(nKey) : undefined;
    if (nHits?.length === 1) {
      entries.push({ shortId: k.shortId, pocomosId: nHits[0].id, method: "name", confidence: "medium", matchedOn: nKey });
      bump("name");
      continue;
    }

    const lzKey = `${normName(k.last)}|${normZip(k.zip)}`;
    const lzHits = normName(k.last) && normZip(k.zip) ? byLastZip.get(lzKey) : undefined;
    if (lzHits?.length === 1) {
      entries.push({ shortId: k.shortId, pocomosId: lzHits[0].id, method: "lastname+zip", confidence: "low", matchedOn: lzKey });
      bump("lastname+zip");
      continue;
    }

    const reason =
      eHits && eHits.length > 1
        ? `email matches ${eHits.length} customers, tie-break failed`
        : pHits && pHits.length > 1
          ? `phone matches ${pHits.length} customers, tie-break failed`
          : nHits && nHits.length > 1
            ? `name matches ${nHits.length} customers`
            : "no email/phone/name/zip match";
    unresolved.push({ shortId: k.shortId, reason, contact: k });
  }

  return { entries, unresolved, byMethod, apiCustomers: api.length };
}

/** Replace the persisted map. */
export async function saveIdMap(entries: IdMapEntry[]): Promise<void> {
  await sql`TRUNCATE customer_id_map`;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const c = entries.slice(i, i + CHUNK);
    await sql`
      INSERT INTO customer_id_map (short_id, pocomos_id, match_method, confidence, matched_on)
      SELECT * FROM UNNEST(
        ${c.map((e) => e.shortId)}::text[],
        ${c.map((e) => e.pocomosId)}::text[],
        ${c.map((e) => e.method)}::text[],
        ${c.map((e) => e.confidence)}::text[],
        ${c.map((e) => e.matchedOn)}::text[]
      )
      ON CONFLICT (short_id) DO UPDATE SET
        pocomos_id = EXCLUDED.pocomos_id,
        match_method = EXCLUDED.match_method,
        confidence = EXCLUDED.confidence,
        matched_on = EXCLUDED.matched_on,
        built_at = NOW()
    `;
  }
}

/** Read the persisted short_id → pocomos_id map. */
export async function loadIdMap(): Promise<Map<string, string>> {
  const rows = (await sql`SELECT short_id, pocomos_id FROM customer_id_map`) as Array<{
    short_id: string;
    pocomos_id: string;
  }>;
  return new Map(rows.map((r) => [String(r.short_id), String(r.pocomos_id)]));
}
