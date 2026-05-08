import {
  categorizeFromSheet,
  fetchTagsCsv,
  parseTagsCsv,
  type SalesSummary,
} from "@/lib/sheets";

const SHEET_ID = "1RGPeS5Mir2p3flA9oDOfaxyfC8xfoXyZnoe1kKCL11s";
const TAB = "Tags";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;

export type LoadResult =
  | { ok: true; summary: SalesSummary }
  | { ok: false; error: string };

export async function loadSalesSummary(): Promise<LoadResult> {
  try {
    const csv = await fetchTagsCsv(CSV_URL);
    const parsed = parseTagsCsv(csv);
    const summary = categorizeFromSheet(parsed, { sheetId: SHEET_ID, tab: TAB });
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
