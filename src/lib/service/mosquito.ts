/**
 * Mosquito service-status domain logic for the /service/overdue report.
 *
 * "Overdue spray" = an Active customer with an active mosquito contract who has
 * not had a Regular mosquito spray in over 15 days (or has had none yet this
 * season). The history itself is scraped from the Pocomos web service-history
 * page (see serviceHistory.ts); this module decides eligibility and computes
 * the overdue status from parsed rows.
 *
 * READ-ONLY: callers never POST / switch the selected contract. If a customer's
 * selected contract isn't mosquito, they go to a "needs manual check" list.
 */
import type { NormalizedContract, NormalizedCustomer } from "@/lib/pocomos";
import type { ServiceRow } from "./serviceHistory";

/** A Regular mosquito service older than this (days) marks the customer overdue. */
export const OVERDUE_THRESHOLD_DAYS = 15;

/**
 * The pest_contract.service_type values that count as a mosquito contract.
 * Kept as a Set for O(1) membership; matching is case-insensitive + trimmed.
 */
export const MOSQUITO_SERVICE_TYPES = new Set(
  [
    "Mosquito Control",
    "Natural Mosquito Control",
    "Mosquito Control - Weekly",
    "Natural Mosquito Control - Weekly",
  ].map((s) => s.toLowerCase())
);

/**
 * RESPRAY TOGGLE — the service Types that count as a "spray" which resets the
 * 15-day clock. Today only "Regular" counts (Initial = first/setup visit,
 * Respray = redo of a missed/complained service). Flip INCLUDE_RESPRAY to true
 * if the team later decides a Respray should also reset the clock.
 */
export const INCLUDE_RESPRAY = false;
const RESETTING_TYPES = new Set(
  INCLUDE_RESPRAY ? ["regular", "respray"] : ["regular"]
);

function norm(s: unknown): string {
  return String(s || "").trim().toLowerCase();
}

export function isMosquitoServiceType(serviceType: unknown): boolean {
  return MOSQUITO_SERVICE_TYPES.has(norm(serviceType));
}

export function isActiveContract(c: NormalizedContract): boolean {
  return norm(c.status) === "active";
}

/** The customer's active mosquito contract, if any (first match). */
export function activeMosquitoContract(
  customer: NormalizedCustomer
): NormalizedContract | null {
  for (const c of customer.contracts) {
    if (isActiveContract(c) && isMosquitoServiceType(c.serviceType)) return c;
  }
  return null;
}

/** Active customer with at least one active mosquito contract. */
export function isEligible(customer: NormalizedCustomer): boolean {
  return (
    norm(customer.status) === "active" && activeMosquitoContract(customer) != null
  );
}

export interface EligibleCustomer {
  /** The id used in /customer/{id}/service-history (Pocomos numeric id). */
  id: string;
  fullName: string;
  mosquitoContractType: string;
}

export function selectEligible(
  customers: NormalizedCustomer[]
): EligibleCustomer[] {
  const out: EligibleCustomer[] = [];
  for (const c of customers) {
    const contract = activeMosquitoContract(c);
    if (norm(c.status) !== "active" || !contract) continue;
    out.push({
      id: String(c.id),
      fullName: c.fullName,
      mosquitoContractType: contract.serviceType || "Mosquito Control",
    });
  }
  return out;
}

/**
 * Is the rendered service-history table a mosquito contract? Uses the
 * Completed Services widget label (authoritative, always present) and falls
 * back to the "Selected Contract:" dropdown label on multi-contract pages.
 */
export function renderedTableIsMosquito(
  tableContractLabel: string | null,
  selectedContractLabel: string | null
): boolean {
  const label = tableContractLabel ?? selectedContractLabel;
  if (!label) return false;
  return /mosquito/i.test(label);
}

export type MosquitoStatus = "overdue" | "current" | "needs_check";

export interface MosquitoStatusResult {
  status: MosquitoStatus;
  /** Why — machine-readable: 'overdue' | 'no_regular_spray_yet' | 'current'
   *  | 'mosquito_not_selected' | 'scrape_failed' | 'no_history'. */
  reason: string;
  /** ISO date (YYYY-MM-DD) of the most recent Regular Complete spray, or null. */
  lastRegularSpray: string | null;
  /** Whole days since lastRegularSpray, or null when there's no spray yet. */
  daysSince: number | null;
}

function toIsoDate(d: Date): string {
  // Local-midnight date → YYYY-MM-DD without TZ shifting.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Compute overdue status from the parsed completed-services rows.
 *
 * Keeps only Status="Complete" AND Type in the resetting set (Regular today;
 * Respray too if INCLUDE_RESPRAY). last_regular_spray = max(date) of those.
 * OVERDUE if days_since > 15, OR there are zero resetting sprays ("no regular
 * spray yet").
 */
export function computeMosquitoStatus(
  rows: ServiceRow[],
  now: Date = new Date()
): MosquitoStatusResult {
  const sprays = rows.filter(
    (r) =>
      norm(r.status) === "complete" &&
      RESETTING_TYPES.has(norm(r.type)) &&
      r.parsedDate != null
  );

  if (sprays.length === 0) {
    return {
      status: "overdue",
      reason: "no_regular_spray_yet",
      lastRegularSpray: null,
      daysSince: null,
    };
  }

  let latest = sprays[0].parsedDate as Date;
  for (const s of sprays) {
    if ((s.parsedDate as Date).getTime() > latest.getTime()) {
      latest = s.parsedDate as Date;
    }
  }
  const daysSince = daysBetween(latest, now);
  const overdue = daysSince > OVERDUE_THRESHOLD_DAYS;
  return {
    status: overdue ? "overdue" : "current",
    reason: overdue ? "overdue" : "current",
    lastRegularSpray: toIsoDate(latest),
    daysSince,
  };
}
