import { getJson, pocomosOffice } from "./client";
import type { PocomosCustomer } from "./types";

interface CustomerListResponse {
  response?: PocomosCustomer[];
}

export async function fetchAllCustomers(): Promise<PocomosCustomer[]> {
  const data = await getJson<CustomerListResponse>(
    `/jwt/pronexis/customer/list/${pocomosOffice()}`
  );
  return data.response || [];
}

export async function fetchActiveCustomers(): Promise<PocomosCustomer[]> {
  const all = await fetchAllCustomers();
  return all.filter((c) => String(c.status || "").toLowerCase() === "active");
}
