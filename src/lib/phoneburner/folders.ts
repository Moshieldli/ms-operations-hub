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
  CUSTOMER_NO_ADD_ONS: "66229452",
  ACTIVE_CUSTOMER: "66233602",
  FOLLOW_UP: "66223503",
  // Default catch-all where contacts land when category_id is invalid.
  // Used by the cleanup script — never written to by the sync.
  DEFAULT_CONTACTS: "47718",
} as const;

export type FolderId = (typeof FOLDERS)[keyof typeof FOLDERS];

/** All folders that conversionCleanup should walk to look for status changes. */
export const OUTBOUND_FOLDERS: FolderId[] = [
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
