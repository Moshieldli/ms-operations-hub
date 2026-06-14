/**
 * Mosquito service-status domain logic for the /service/overdue report.
 *
 * "Overdue spray" = a customer with an ELIGIBLE mosquito contract who has not
 * had a mosquito service in over 15 days (or has had none yet this season).
 *
 * Eligibility (tightened 2026-06-10 to drop zombie "active-in-name-only"
 * accounts): the customer is Active AND has a mosquito-family contract that is
 *   (a) active — status active, not cancelled, and (for non-renewing contracts)
 *       date_end not passed; auto-renewing contracts keep a stale date_end so
 *       date_end is ignored for them, AND
 *   (b) carries a current-year tag — a tag starting with "${CURRENT_YEAR} -" on
 *       that mosquito contract's OWN per-contract tags.
 * The current-year tag is the real zombie filter: a customer last sprayed in
 * 2021–2024 whose contract still reads "Active" has no 2026 tag and is dropped.
 *
 * CLOCK RULE: any completed mosquito service (any service Type) resets the
 * 15-day clock — NOT Regular-only. This makes the per-customer "Last Service"
 * date from /customers/data authoritative for mosquito-only customers (no
 * scrape needed). INCLUDE_RESPRAY / COUNT_ANY_SERVICE_TYPE below are the
 * toggles if we ever want to narrow back to Regular(+Respray)-only.
 *
 * READ-ONLY: callers never POST / switch the selected contract. If a scraped
 * customer's selected contract isn't mosquito, they go to "needs manual check".
 */
import { CURRENT_YEAR } from "@/lib/pocomos";
import type { NormalizedContract, NormalizedCustomer } from "@/lib/pocomos";
import type { ServiceRow } from "./serviceHistory";

/** A mosquito service older than this (days) marks the customer overdue. */
export const OVERDUE_THRESHOLD_DAYS = 15;

/**
 * A customer who signed up within this many days is excluded from overdue —
 * we simply haven't had a chance to service them yet. They reappear once a
 * spray is actually due (signup age >= this). NOTE: this is overridden by an
 * open balance (precedence rule 1): a brand-new signup who already owes money
 * still surfaces in the paused section.
 */
export const NEW_SIGNUP_GRACE_DAYS = 3;

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
 * CLOCK-RULE toggles.
 *  - COUNT_ANY_SERVICE_TYPE (default true): any completed mosquito service
 *    resets the 15-day clock. This is what keeps the bulk /customers/data
 *    "Last Service" date (which is any-type) authoritative for mosquito-only
 *    customers.
 *  - If COUNT_ANY_SERVICE_TYPE is flipped to false, the clock falls back to the
 *    RESETTING_TYPES set: "Regular" only, plus "Respray" when INCLUDE_RESPRAY.
 */
export const COUNT_ANY_SERVICE_TYPE = true;
export const INCLUDE_RESPRAY = false;
const RESETTING_TYPES = new Set(
  INCLUDE_RESPRAY ? ["regular", "respray"] : ["regular"]
);

function norm(s: unknown): string {
  return String(s || "").trim().toLowerCase();
}

/** Start-of-today (local midnight) in epoch ms. */
function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Parse a Pocomos DB date ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS") → local Date. */
export function parseDbDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

export function isMosquitoServiceType(serviceType: unknown): boolean {
  return MOSQUITO_SERVICE_TYPES.has(norm(serviceType));
}

/**
 * Weekly-cadence detection for the display-only "Weekly" pill. True when the
 * contract's service_frequency OR service_type name says "Weekly" — but NOT
 * "Bi-weekly" (which also contains the substring "weekly"). Bi-weekly → false.
 * Purely cosmetic: does NOT affect the flat 15-day overdue threshold.
 */
export function isWeeklyContract(c: NormalizedContract): boolean {
  const weekly = (s: string) => /weekly/.test(s) && !/bi-?weekly/.test(s);
  return weekly(norm(c.serviceFrequency)) || weekly(norm(c.serviceType));
}

/**
 * Is this contract currently live? Status active, not cancelled, and — for
 * NON-renewing contracts only — its date_end hasn't passed. Auto-renewing
 * contracts keep a stale original date_end, so date_end is ignored for them.
 */
export function isContractActive(c: NormalizedContract, now: Date = new Date()): boolean {
  if (norm(c.status) !== "active") return false;
  const cancelled = c.dateCancelled && norm(c.dateCancelled) !== "null";
  if (cancelled) return false;
  if (!c.autoRenew && c.dateEnd) {
    const end = parseDbDate(c.dateEnd);
    if (end && end.getTime() < startOfToday(now)) return false;
  }
  return true;
}

/** Does this contract carry a current-year tag ("${CURRENT_YEAR} - ...")? */
export function hasCurrentYearTag(c: NormalizedContract): boolean {
  const prefix = `${CURRENT_YEAR} -`;
  return c.tags.some((t) => t.trim().startsWith(prefix));
}

/**
 * The customer's ELIGIBLE mosquito contract (active + mosquito type + current-
 * year tag), if any. First match wins.
 */
export function eligibleMosquitoContract(
  customer: NormalizedCustomer
): NormalizedContract | null {
  for (const c of customer.contracts) {
    if (
      isContractActive(c) &&
      isMosquitoServiceType(c.serviceType) &&
      hasCurrentYearTag(c)
    ) {
      return c;
    }
  }
  return null;
}

/** True if the customer also holds an active NON-mosquito contract (add-on). */
export function hasActiveNonMosquitoContract(customer: NormalizedCustomer): boolean {
  return customer.contracts.some(
    (c) => isContractActive(c) && !isMosquitoServiceType(c.serviceType)
  );
}

/** Active customer with at least one eligible mosquito contract. */
export function isEligible(customer: NormalizedCustomer): boolean {
  return (
    norm(customer.status) === "active" &&
    eligibleMosquitoContract(customer) != null
  );
}

export interface EligibleCustomer {
  /** The id used in /customer/{id}/service-history (Pocomos numeric id). */
  id: string;
  fullName: string;
  mosquitoContractType: string;
  /**
   * True when the customer ALSO has an active non-mosquito contract. For these
   * the bulk /customers/data "Last Service" date may reflect the add-on, so
   * they need a targeted service-history scrape. Mosquito-only customers
   * (false) can trust the bulk date directly.
   */
  hasAddOn: boolean;
  /**
   * Sign-up date sourced from the eligible mosquito contract's top-level
   * `date_start` (the ACTIVE contract that passed eligibility), as ISO
   * "YYYY-MM-DD" or null. This is what Pocomos's Edit screen calls "Date Signed
   * Up". Replaces the stale customer-level original-signup date (grid col 7),
   * which was wrong for re-signed customers. NEVER date_end (stale on
   * auto-renew contracts). Drives both the displayed sign-up and the
   * new-signup grace exclusion.
   */
  signUpDate: string | null;
  /** Weekly-cadence marker for the display-only "Weekly" pill. */
  isWeekly: boolean;
}

export function selectEligible(
  customers: NormalizedCustomer[]
): EligibleCustomer[] {
  const out: EligibleCustomer[] = [];
  for (const c of customers) {
    if (norm(c.status) !== "active") continue;
    const contract = eligibleMosquitoContract(c);
    if (!contract) continue;
    const start = parseDbDate(contract.dateStart);
    out.push({
      id: String(c.id),
      fullName: c.fullName,
      mosquitoContractType: contract.serviceType || "Mosquito Control",
      hasAddOn: hasActiveNonMosquitoContract(c),
      signUpDate: start ? toIsoDate(start) : null,
      isWeekly: isWeeklyContract(contract),
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

export type MosquitoStatus =
  | "overdue"
  | "current"
  | "needs_check"
  | "paused_balance"
  | "excluded_new";

export interface MosquitoStatusResult {
  status: MosquitoStatus;
  /** Why — machine-readable: 'overdue' | 'no_service_yet' | 'current'
   *  | 'mosquito_not_selected' | 'scrape_failed' | 'no_history'
   *  | 'open_balance' | 'new_signup'. */
  reason: string;
  /** ISO date (YYYY-MM-DD) of the most recent qualifying mosquito service, or null. */
  lastRegularSpray: string | null;
  /** Whole days since lastRegularSpray, or null when there's no service yet. */
  daysSince: number | null;
}

/**
 * Bucket-precedence rules that take effect BEFORE any service-date logic.
 * Applied in this order (per the report spec):
 *   1. open balance > 0           → "paused_balance" (spray intentionally paused
 *                                    on unpaid accounts; goes to its own section)
 *   2. signed up < grace days ago → "excluded_new" (not serviced yet)
 * Returns null when neither applies and the caller should fall through to the
 * service-date status (no-service-yet pin / overdue / current).
 */
export function preServiceBucket(
  openBalance: number,
  signUp: Date | null,
  now: Date = new Date()
): MosquitoStatusResult | null {
  if (openBalance > 0) {
    return {
      status: "paused_balance",
      reason: "open_balance",
      lastRegularSpray: null,
      daysSince: null,
    };
  }
  if (signUp) {
    const age = daysBetween(signUp, now);
    if (age >= 0 && age < NEW_SIGNUP_GRACE_DAYS) {
      return {
        status: "excluded_new",
        reason: "new_signup",
        lastRegularSpray: null,
        daysSince: null,
      };
    }
  }
  return null;
}

function toIsoDate(d: Date): string {
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

/** Overdue if days_since > threshold, OR no service date at all (pinned). */
function statusFor(latest: Date | null, now: Date): MosquitoStatusResult {
  if (!latest) {
    return {
      status: "overdue",
      reason: "no_service_yet",
      lastRegularSpray: null,
      daysSince: null,
    };
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

/**
 * BULK path: compute status straight from the per-customer "Last Service" date
 * pulled from /customers/data column 8. Valid for mosquito-only customers,
 * where any service is a mosquito service.
 */
export function statusFromLastServiceDate(
  lastService: Date | null,
  now: Date = new Date()
): MosquitoStatusResult {
  return statusFor(lastService, now);
}

/**
 * SCRAPE path: compute status from the parsed completed-services rows of a
 * customer's service-history page.
 *
 * Keeps Status="Complete" rows; by default (COUNT_ANY_SERVICE_TYPE) every
 * completed service counts as resetting the clock, else only RESETTING_TYPES
 * (Regular, +Respray if INCLUDE_RESPRAY). last_regular_spray = max(date).
 */
export function computeMosquitoStatus(
  rows: ServiceRow[],
  now: Date = new Date()
): MosquitoStatusResult {
  const sprays = rows.filter((r) => {
    if (norm(r.status) !== "complete" || r.parsedDate == null) return false;
    if (COUNT_ANY_SERVICE_TYPE) return true;
    return RESETTING_TYPES.has(norm(r.type));
  });

  if (sprays.length === 0) return statusFor(null, now);

  let latest = sprays[0].parsedDate as Date;
  for (const s of sprays) {
    if ((s.parsedDate as Date).getTime() > latest.getTime()) {
      latest = s.parsedDate as Date;
    }
  }
  return statusFor(latest, now);
}
