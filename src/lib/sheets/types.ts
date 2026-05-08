export type Bucket = "NEW" | "RETURNING" | "RETAINED" | "AT_RISK" | "CANCELLED";

export interface CustomerRecord {
  customerNumber: string;
  yearTags: Set<string>;
  rawTagsCells: string[];
  rowCount: number;
}

export interface SheetParseResult {
  /** Map keyed by customerNumber. Active customers only (junk filtered). */
  customers: Map<string, CustomerRecord>;
  /** Total non-junk rows across all customers (used as Active services count for V1). */
  activeServiceRows: number;
  /** Total raw rows (including junk) seen in the sheet. */
  totalRows: number;
  /** Rows skipped because Customer ID was 0, blank, or non-numeric. */
  junkRowsSkipped: number;
}

export interface SalesSummary {
  asOf: string;
  year: string;
  source: {
    kind: "google-sheets-csv";
    sheetId: string;
    tab: string;
  };
  totals: {
    activeCustomers: number;
    activeServices: number;
    junkRowsSkipped: number;
    totalRowsSeen: number;
  };
  buckets: Record<Bucket, number>;
  retainedSubtypes: { auto: number; seb: number; eb: number };
  debug: {
    untagged: number;
    uncategorized: number;
    untaggedSampleIds: string[];
    uncategorizedSampleIds: string[];
  };
}
