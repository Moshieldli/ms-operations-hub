/**
 * Real PhoneBurner folder IDs, sourced from `GET /folders` (NOT from the
 * `view_id=N` URL fragment in the dialer UI — those are dialer view session
 * IDs, not folder IDs). REFERENCE.md rev 3 mistakenly substituted view_ids
 * for folder IDs; the original 8-digit values from rev 1/2 were correct
 * all along. All values below confirmed against the live `GET /folders`
 * response as of 2026-05-15.
 */
export const FOLDERS = {
  LEADS_FRESH: "66223880",
  LEADS_GENERAL: "66223881",
  LEADS_COMPETITOR: "66223882",
  LEADS_FINANCIAL: "66223883",
  CANCELLED_COMPETITOR: "66223884",
  CANCELLED_FINANCIAL: "66223885",
  CANCELLED_RESULTS: "66223886",
  CANCELLED_NO_REACH: "66223887",
  CANCELLED_PERSONAL: "66223888",
  ACTIVE_CUSTOMER: "66233602",
  // Wellness-call campaign (2026 season) — probed 2026-07-20 by
  // scripts/probe-wellness-folders.ts. Queue = Rena's dial list of active
  // customers with 2+ sprays this season; ONE dial attempt of ANY kind moves
  // the contact to Called for the rest of the season. BOTH are EXEMPT (they
  // hold active customers on purpose) — never police them.
  WELLNESS_QUEUE: "66255089",
  WELLNESS_CALLED: "66255090",
  FOLLOW_UP: "66223503",
  // Default catch-all where contacts land when category_id is invalid.
  // Used by the cleanup script — never written to by the sync.
  DEFAULT_CONTACTS: "47718",
} as const;

export type FolderId = (typeof FOLDERS)[keyof typeof FOLDERS];

/**
 * POLICED_FOLDERS — the dial / cancelled buckets the conversion sweep WALKS.
 * Each run, every contact in these folders is reconciled against the live
 * active-customer roster; matches are moved OUT to DESTINATION_FOLDER. This is
 * the sweep's ONLY input, so any folder NOT listed here is structurally exempt.
 *
 *   Fresh 66223880, General 66223881, Competitor 66223882, Financial 66223883,
 *   and the five Cancelled buckets 66223884–66223888.
 */
export const POLICED_FOLDERS: FolderId[] = [
  FOLDERS.LEADS_FRESH,
  FOLDERS.LEADS_GENERAL,
  FOLDERS.LEADS_COMPETITOR,
  FOLDERS.LEADS_FINANCIAL,
  FOLDERS.CANCELLED_COMPETITOR,
  FOLDERS.CANCELLED_FINANCIAL,
  FOLDERS.CANCELLED_RESULTS,
  FOLDERS.CANCELLED_NO_REACH,
  FOLDERS.CANCELLED_PERSONAL,
];

/** Where the sweep moves matched active customers. */
export const DESTINATION_FOLDER: FolderId = FOLDERS.ACTIVE_CUSTOMER;

/**
 * EXEMPT_FOLDERS — folders the sweep must NEVER touch.
 *
 * Today this is just Active Customer (the destination): a contact already
 * there is, by definition, done. Exemption is STRUCTURAL — the sweep only ever
 * reads POLICED_FOLDERS, so anything not policed is already ignored. This
 * constant exists so the intent is explicit and greppable.
 *
 * FUTURE: a planned active-customer CALLING project will own its own folders
 * (e.g. a "Renewal calls" or "Save calls" queue). Those folders will hold
 * active customers ON PURPOSE — add each new one HERE so this sweep keeps
 * leaving them alone. Do NOT add them to POLICED_FOLDERS.
 */
export const EXEMPT_FOLDERS: FolderId[] = [
  FOLDERS.ACTIVE_CUSTOMER,
  // Wellness campaign (2026): BOTH folders hold ACTIVE customers on purpose —
  // the queue is the point of the campaign, and Called preserves the one-call-
  // per-season record. If either were policed, the hourly conversion sweep
  // would empty the queue within an hour. NEVER move these to POLICED_FOLDERS.
  FOLDERS.WELLNESS_QUEUE,
  FOLDERS.WELLNESS_CALLED,
  // <-- future active-customer-calling project folders go here
];

/** Wellness campaign — the self-refilling dial queue (EXEMPT, never policed). */
export const WELLNESS_QUEUE_FOLDER: FolderId = FOLDERS.WELLNESS_QUEUE;
/** Wellness campaign — one dial attempt of any kind lands the contact here. */
export const WELLNESS_CALLED_FOLDER: FolderId = FOLDERS.WELLNESS_CALLED;
