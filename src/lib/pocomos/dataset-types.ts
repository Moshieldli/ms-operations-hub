/**
 * Normalized view of a Pocomos customer used by the dashboard data layer.
 * Mirrors the fields the operations team actually filters on; deliberately
 * smaller than the raw Pocomos response.
 */
export interface NormalizedContract {
  contractId: string | number;
  pestContractId?: string | number;
  status?: string;
  dateStart?: string | null;
  dateEnd?: string | null;
  dateCreated?: string | null;
  dateCancelled?: string | null;
  /** Broad 11-category service type from pest_contract.service_type.name (has an "Other" catch-all). */
  serviceType?: string;
  /** Granular contract type from contract.agreement.name (the Pocomos "Contract Type" pick-list). */
  contractType?: string;
  serviceFrequency?: string;
  tags: string[];
}

export type CustomerDepth = "full" | "slim";

export interface NormalizedCustomer {
  id: string | number;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email?: string;
  phone?: string;
  zip?: string;
  status: string;

  // Dates (raw Pocomos format: "YYYY-MM-DD HH:MM:SS" or null)
  dateCreated?: string | null;
  lastServiceDate?: string | null;
  nextServiceDate?: string | null;
  /**
   * Pocomos has no `cancel_date` field at the customer level (verified
   * against 2,659 inactive customers — every cancel-date candidate field
   * was 0% populated). For Inactive customers we use lastServiceDate as
   * the proxy: the date they last received service is when they
   * effectively stopped being an active customer.
   *
   * `null` for Active / On-Hold customers.
   */
  cancelDate?: string | null;

  // Sales / marketing — only populated on Active customers (the customer
  // list endpoint returns a skinny record for Inactive).
  salesStatus?: string;
  marketingType?: string;

  // Tags. Empty array for slim records (we haven't fetched per-contract
  // tags for inactive customers in the live path — populated by the cron).
  tags: string[];

  contracts: NormalizedContract[];

  /**
   * "full" = customer + contracts + per-contract tags have been fetched.
   * "slim" = only customer-list fields (Inactive in the live path).
   */
  depth: CustomerDepth;
}

export interface DatasetDiagnostics {
  totalCustomers: number;
  activeCount: number;
  inactiveCount: number;
  onHoldCount: number;
  otherStatusCount: number;
  fullDepthCount: number;
  slimDepthCount: number;
  contractsFetched: number;
  contractsFailed: number;
  tagsFetched: number;
  tagsFailed: number;
  fetchDurationMs: number;
}

export interface PocomosDataset {
  asOf: string;
  customers: NormalizedCustomer[];
  diagnostics: DatasetDiagnostics;
}
