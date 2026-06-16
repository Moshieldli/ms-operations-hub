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
  // <-- future active-customer-calling project folders go here
];
