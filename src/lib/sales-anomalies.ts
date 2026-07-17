/**
 * "Return-rate anomalies" (rev 19) — a live, SELF-CLEARING roster of every
 * record we currently cannot measure cleanly.
 *
 * This card is about MEASUREMENT problems, not tag hygiene. Anything whose only
 * issue is "active but missing this year's tag" belongs to the Missing-tags card
 * and is deliberately NOT duplicated here — the one exception is a customer we
 * have SPRAY EVIDENCE for who still has no current-year tag, because that
 * actively corrupts the buckets (they're being served but are invisible to every
 * tag-gated count).
 *
 * Nothing is persisted: membership is recomputed on every refresh from live
 * data, so fixing a record in Pocomos makes it disappear on the next load.
 *
 * ADDING A CLASS: append an ANOMALY_CLASSES entry and push items with that key
 * from `buildReturnRateAnomalies`. The card renders whatever it's handed —
 * classes with zero items are hidden automatically.
 */
import { sql } from "@/lib/db";
import { CURRENT_YEAR } from "@/lib/pocomos";
import { getServiceCountsData } from "@/lib/service/serviceCounts";
import type { Person } from "@/lib/sales-taxonomy";

const POCOMOS_BASE = "https://mypocomos.net";

export type AnomalyClassKey =
  | "duplicate_records"
  | "unmapped_short_id"
  | "unreadable_history"
  | "sprays_without_tag";

export interface AnomalyClass {
  key: AnomalyClassKey;
  label: string;
  /** What it means + why it blocks measurement. Shown under the class heading. */
  description: string;
  /** The concrete fix an operator performs in Pocomos. */
  fix: string;
}

/** Registry — order here is the order the card renders. */
export const ANOMALY_CLASSES: AnomalyClass[] = [
  {
    key: "duplicate_records",
    label: "Duplicate customer records",
    description:
      "The same person exists as two or more Pocomos records (Pocomos creates a NEW record when a lead converts instead of reusing the old one). Their history splits across the twins, so one twin looks like it never returned.",
    fix: "Merge the duplicates in Pocomos, keeping the record with the live contract.",
  },
  {
    key: "unmapped_short_id",
    label: "Export customer with no confident match",
    description:
      "A customer in the bulk job export whose 6-digit export id can't be matched to exactly one Pocomos record by email, phone, name or zip — usually because several records share the same email AND name. Their jobs are dropped rather than mis-attributed, so they're missing from the denominator.",
    fix: "Give the duplicate records distinct emails, or merge them.",
  },
  {
    key: "unreadable_history",
    label: "Unreadable mosquito history",
    description:
      "The customer's service-history page renders a NON-mosquito contract by default, and we never switch a customer's contract, so this season's spray count can't be confirmed. They fail closed (excluded).",
    fix: "Make the mosquito contract the customer's active/default contract in Pocomos.",
  },
  {
    key: "sprays_without_tag",
    label: `Sprayed this year but no ${CURRENT_YEAR} tag`,
    description: `Active, with completed ${CURRENT_YEAR} mosquito services on record, but carrying no "${CURRENT_YEAR} -" tag. They're being served yet are invisible to every tag-gated count (Active Customers, the season buckets).`,
    fix: `Apply the correct ${CURRENT_YEAR} tag to the mosquito contract.`,
  },
];

export interface AnomalyItem {
  classKey: AnomalyClassKey;
  /** Pocomos web id, or the export short id when there's no matched record. */
  id: string;
  name: string;
  /** Human-readable, record-specific reason. */
  reason: string;
  /** Profile link, or null when we have no web id to link to. */
  profileUrl: string | null;
  /** Sibling records (duplicate twins) — each links out too. */
  related?: Array<{ id: string; name: string; profileUrl: string }>;
  /** Extra contact context when there's no profile to open. */
  contact?: string;
}

export interface ReturnRateAnomalies {
  classes: Array<AnomalyClass & { count: number }>;
  items: AnomalyItem[];
  total: number;
  asOf: string;
}

const profile = (id: string) => `${POCOMOS_BASE}/customer/${id}/service-information`;

/**
 * Build the anomaly roster from live data.
 *
 * @param people      every known customer (id → identity/tags/status)
 * @param missingTagIds ids already listed on the Missing-tags card — excluded
 *                    from `sprays_without_tag` unless we hold spray evidence,
 *                    so the two cards don't restate each other.
 */
export async function buildReturnRateAnomalies({
  people,
}: {
  people: Map<string, Person>;
}): Promise<ReturnRateAnomalies> {
  const cy = Number(CURRENT_YEAR);
  const data = await getServiceCountsData();
  const items: AnomalyItem[] = [];

  // ---- 1. Duplicate customer records (same human, several Pocomos ids) ----
  // Grouped by email: the lead-conversion duplicate set. Only report groups where
  // the split actually matters — at least one twin carries return-rate-relevant
  // evidence (a recent tag or sprays) — otherwise two dormant shells are noise.
  const byEmail = new Map<string, Person[]>();
  for (const p of people.values()) {
    if (!p.email) continue;
    byEmail.set(p.email, [...(byEmail.get(p.email) || []), p]);
  }
  const relevant = (p: Person) =>
    p.active ||
    p.tags.some((t) => /^\d{4} -/.test(String(t).trim())) ||
    Object.keys(data.counts.get(p.id) ?? {}).length > 0;
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    if (!group.some(relevant)) continue;
    // Anchor on the record the rest of the app prefers (active first), and list
    // the twins beside it so an operator can open both and merge.
    const sorted = [...group].sort((a, b) => Number(b.active) - Number(a.active));
    const [head, ...twins] = sorted;
    const sprays = (p: Person) => data.counts.get(p.id)?.[cy] ?? 0;
    items.push({
      classKey: "duplicate_records",
      id: head.id,
      name: head.name,
      reason:
        `${group.length} records share ${email} — ` +
        sorted
          .map((p) => `${p.id} (${p.status}${sprays(p) ? `, ${sprays(p)} ${cy} sprays` : ""})`)
          .join(" · "),
      profileUrl: profile(head.id),
      related: twins.map((p) => ({ id: p.id, name: p.name, profileUrl: profile(p.id) })),
    });
  }

  // ---- 2. Unmapped short ids (in an export, no confident web match) ----
  const unmapped = (await sql`
    SELECT j.short_id,
           MAX(j.customer_name) AS name,
           MAX(j.email) AS email,
           MAX(j.phone) AS phone,
           COUNT(*)::int AS jobs
    FROM (
      SELECT short_id, customer_name, email, phone FROM completed_jobs_2025
      UNION ALL
      SELECT short_id, customer_name, email, phone FROM realgreen_jobs_2024
    ) j
    LEFT JOIN customer_id_map m ON m.short_id = j.short_id
    WHERE m.short_id IS NULL
    GROUP BY j.short_id
    ORDER BY jobs DESC
  `) as Array<{ short_id: string; name: string | null; email: string | null; phone: string | null; jobs: number }>;
  for (const u of unmapped) {
    items.push({
      classKey: "unmapped_short_id",
      id: u.short_id,
      name: u.name || `#${u.short_id}`,
      reason: `Export id ${u.short_id} (${u.jobs} job${u.jobs === 1 ? "" : "s"}) has no confident Pocomos match — their jobs are excluded from the counts.`,
      profileUrl: null,
      contact: [u.email, u.phone].filter(Boolean).join(" · ") || undefined,
    });
  }

  // ---- 3. Unreadable mosquito history (table_ok = false) ----
  const badTable = (await sql`
    SELECT pocomos_id FROM mosquito_service_scrape WHERE table_ok = false
  `) as Array<{ pocomos_id: string }>;
  for (const r of badTable) {
    const id = String(r.pocomos_id);
    const p = people.get(id);
    // Only worth surfacing while they're a live customer — a dormant record with
    // an unreadable table isn't blocking any measurement.
    if (!p?.active) continue;
    items.push({
      classKey: "unreadable_history",
      id,
      name: p.name,
      reason: `Service-history page renders a non-mosquito contract by default, so ${cy} sprays can't be counted.`,
      profileUrl: profile(id),
    });
  }

  // ---- 4. Active + CY sprays but no CY tag ----
  // NOTE: this overlaps the Missing-tags card by construction (both are "active,
  // no current-year tag"). It earns its place here because spray evidence makes
  // it a MEASUREMENT fault: real, served customers sitting outside every
  // tag-gated count. The Missing-tags card still owns the full hygiene roster.
  for (const p of people.values()) {
    if (!p.active) continue;
    if (p.tags.some((t) => String(t).trim().startsWith(`${cy} -`))) continue;
    const sprays = data.counts.get(p.id)?.[cy] ?? 0;
    if (sprays < 1) continue;
    items.push({
      classKey: "sprays_without_tag",
      id: p.id,
      name: p.name,
      reason: `${sprays} completed ${cy} mosquito service${sprays === 1 ? "" : "s"} but no "${cy} -" tag — excluded from Active Customers and the season buckets.`,
      profileUrl: profile(p.id),
    });
  }

  items.sort(
    (a, b) =>
      ANOMALY_CLASSES.findIndex((c) => c.key === a.classKey) -
        ANOMALY_CLASSES.findIndex((c) => c.key === b.classKey) ||
      a.name.localeCompare(b.name)
  );

  const classes = ANOMALY_CLASSES.map((c) => ({
    ...c,
    count: items.filter((i) => i.classKey === c.key).length,
  }));

  return { classes, items, total: items.length, asOf: new Date().toISOString() };
}
