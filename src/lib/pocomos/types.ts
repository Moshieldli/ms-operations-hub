export interface PocomosCustomer {
  id: number | string;
  status?: string;
  salesStatus?: string;
  sales_status?: string;
  postalCode?: string;
  postal_code?: string;
  marketingType?: string;
  marketing_type?: string;
  dateCreated?: string;
  date_created?: string;
  customer_number?: string | number;
  customerNumber?: string | number;
  tags?: unknown;
  tag_list?: unknown;
  customerTags?: unknown;
  [key: string]: unknown;
}

export interface PocomosContract {
  status?: string;
  sales_status?: string;
  salesStatus?: string;
  date_created?: string;
  tags?: unknown;
  tag_list?: unknown;
  profile?: Record<string, unknown>;
  pest_contract?: {
    service_type?: { name?: string };
    service_frequency?: string;
    date_created?: string;
    tags?: unknown;
    tag_list?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PocomosTag {
  id: number | string;
  name?: string;
  tag?: string;
  [key: string]: unknown;
}

export interface NormalizedRecord {
  id: string;
  apiId: string;
  status: string;
  sales: string;
  svc: string;
  freq: string;
  zip: string;
  tags: string;
  mkt: string;
  creation: string;
}

export type Bucket = "NEW" | "RETURNING" | "RETAINED" | "AT_RISK" | "CANCELLED";

export interface CategorizedSummary {
  asOf: string;
  year: string;
  totals: {
    activeCustomers: number;
    activeServices: number;
    cancelledCustomers: number;
    onHoldCustomers: number;
    categorized: number;
  };
  buckets: Record<Bucket, number>;
  retainedSubtypes: { auto: number; seb: number; eb: number };
  thisWeek: {
    weekStart: string;
    newCustomers: number;
    newServices: number;
    newCustomersToday: number;
    newServicesToday: number;
  };
  diagnostics: {
    totalCustomersFromApi: number;
    contractsFetched: number;
    contractsFailed: number;
    customerNumberSource: string;
    sampleContractProfileKeys: string[];
    fetchDurationMs: number;
  };
}
