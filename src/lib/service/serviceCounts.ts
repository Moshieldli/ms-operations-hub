/**
 * Resumable scrape job: per-customer-per-year COMPLETED mosquito-family service
 * counts. This is the evidence layer for the ops-canonical return-rate metric
 * (§5.8): a "real year-Y customer" and a "return in year Y" both mean the
 * customer received >= MIN_RETURN_TREATMENTS completed mosquito services that
 * year — a real treatment history, not a tag and not a one-off.
 *
 * Event Spray NEVER counts: it is a separate Pocomos contract and never appears
 * on the mosquito contract's service-history table, so counting Complete rows on
 * that table (gated by renderedTableIsMosquito) excludes it by construction.
 *
 * COHORT (who we scrape): every customer holding a mosquito-family contract that
 * carries a {CY-2 | CY-1 | CY} tag — the universe that could be a real customer
 * in any of the two return-rate pairs. Active customers come from the live
 * dataset; non-active from the enriched `customers` table.
 *
 * Cost: ~1 GET per cohort customer (~1,800). Too much for one request, so this
 * runs as its own resumable nightly cron in budgeted chunks: un-scraped members
 * first (backfill), then active members re-scraped daily (2026 counts grow as
 * the season runs). Coverage is tracked in `mosquito_service_scrape`; the
 * /sales card shows "(computing — N% covered)" until the cohort is fully walked.
 *
 * READ-ONLY against Pocomos (GET service-history; never switches contracts). An
 * add-on customer whose default rendered table isn't the mosquito contract is
 * recorded with table_ok=false (counts unknown — we don't switch contracts).
 */
import { initSchema, sql } from "@/lib/db";
import { getDataset, CURRENT_YEAR, fetchPooled } from "@/lib/pocomos";
import { getSessionedHtml } from "@/lib/pocomos/webSession";
import {
  parseServiceHistory,
  countCompletedByYear,
  looksLikeLoginPage,
} from "./serviceHistory";
import { isMosquitoServiceType, renderedTableIsMosquito } from "./mosquito";

const SCRAPE_CONCURRENCY = 5; // Pocomos hard cap
const PER_REQUEST_PAUSE_MS = 150;

/** Years the return-rate metric needs counts for: [CY-2, CY-1, CY]. */
export function returnRateYears(): number[] {
  const cy = Number(CURRENT_YEAR);
  return [cy - 2, cy - 1, cy];
}

interface CohortMember {
  id: string;
  name: string;
  active: boolean;
}

const hasMosquitoYearTag = (
  contracts: Array<{ serviceType?: string | null; tags?: string[] }>,
  years: number[]
): boolean =>
  contracts.some(
    (c) =>
      isMosquitoServiceType(c.serviceType) &&
      (c.tags || []).some((t) => years.some((y) => String(t).trim().startsWith(`${y} -`)))
  );

/** Build the return-rate cohort (mosquito contract + a {CY-2..CY} tag). */
export async function buildServiceCountCohort(): Promise<CohortMember[]> {
  const years = returnRateYears();
  const ds = await getDataset({ force: false });
  const out = new Map<string, CohortMember>();
  for (const c of ds.customers) {
    if (c.status.toLowerCase() !== "active") continue;
    const contracts = c.contracts.map((k) => ({ serviceType: k.serviceType, tags: k.tags }));
    if (hasMosquitoYearTag(contracts, years)) {
      out.set(String(c.id), { id: String(c.id), name: c.fullName, active: true });
    }
  }
  const rows = (await sql`
    SELECT pocomos_id, full_name, contracts FROM customers WHERE lower(status) <> 'active'
  `) as Array<{ pocomos_id: string; full_name: string; contracts: unknown }>;
  for (const r of rows) {
    const id = String(r.pocomos_id);
    if (out.has(id)) continue;
    const contracts = Array.isArray(r.contracts)
      ? (r.contracts as Array<{ serviceType?: string | null; tags?: string[] }>)
      : [];
    if (hasMosquitoYearTag(contracts, years)) {
      out.set(id, { id, name: r.full_name || id, active: false });
    }
  }
  return [...out.values()];
}

export interface ServiceCountMeta {
  startedAt: string;
  finishedAt: string;
  cohortSize: number;
  scrapedThisRun: number;
  tableOk: number;
  tableNotOk: number;
  failed: number;
  /** Cohort members with a scrape row (any table_ok) after this run. */
  covered: number;
  /** covered / cohortSize, percent (0–100). */
  coveragePct: number;
  reachedEnd: boolean;
  durationMs: number;
}

export interface ServiceCountOptions {
  budgetMs?: number;
  maxCustomers?: number;
  /** Re-scrape ALL cohort members, not just un-scraped + stale-active ones. */
  force?: boolean;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
function todayStartIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Scrape a budgeted chunk of the cohort and upsert per-year completed mosquito
 * service counts + a coverage row. Resumable: prioritises never-scraped members,
 * then active members not yet refreshed today (their in-progress CY count grows).
 */
export async function refreshServiceCounts(
  options: ServiceCountOptions = {}
): Promise<ServiceCountMeta> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const budgetMs = options.budgetMs ?? 250_000;
  const maxCustomers = options.maxCustomers ?? 5000;
  const years = returnRateYears();
  await initSchema();

  const cohort = await buildServiceCountCohort();
  const cohortIds = new Set(cohort.map((m) => m.id));

  // Prune scrape + count rows for ids no longer in the cohort.
  const scrapedRows = (await sql`
    SELECT pocomos_id, scraped_at FROM mosquito_service_scrape
  `) as Array<{ pocomos_id: string; scraped_at: string | Date }>;
  const stale = scrapedRows.map((r) => String(r.pocomos_id)).filter((id) => !cohortIds.has(id));
  if (stale.length) {
    await sql`DELETE FROM mosquito_service_scrape WHERE pocomos_id = ANY(${stale})`;
    await sql`DELETE FROM mosquito_service_counts WHERE pocomos_id = ANY(${stale})`;
  }

  const scrapedAt = new Map<string, string>();
  for (const r of scrapedRows) {
    if (cohortIds.has(String(r.pocomos_id))) {
      const iso = r.scraped_at instanceof Date ? r.scraped_at.toISOString() : String(r.scraped_at);
      scrapedAt.set(String(r.pocomos_id), iso);
    }
  }

  // Work selection: never-scraped first, then active members not refreshed today.
  const today = todayStartIso();
  const neverScraped = cohort.filter((m) => !scrapedAt.has(m.id));
  const staleActive = options.force
    ? cohort.filter((m) => scrapedAt.has(m.id))
    : cohort.filter((m) => m.active && (scrapedAt.get(m.id) || "").slice(0, 10) < today);
  const work = [...neverScraped, ...staleActive].slice(0, maxCustomers);

  let scrapedThisRun = 0;
  let tableOk = 0;
  let tableNotOk = 0;
  let budgetHit = false;

  const scrapeOne = async (m: CohortMember): Promise<void> => {
    if (Date.now() - t0 > budgetMs) {
      budgetHit = true;
      return;
    }
    await sleep(PER_REQUEST_PAUSE_MS);
    const html = await getSessionedHtml(`/customer/${m.id}/service-history`);
    if (looksLikeLoginPage(html)) throw new Error("login page returned (session)");
    const parsed = parseServiceHistory(html);
    const ok = renderedTableIsMosquito(parsed.tableContractLabel, parsed.selectedContractLabel);
    if (ok) {
      const counts = countCompletedByYear(parsed.rows, years);
      await sql`DELETE FROM mosquito_service_counts WHERE pocomos_id = ${m.id}`;
      for (const y of years) {
        if (counts[y] > 0) {
          await sql`
            INSERT INTO mosquito_service_counts (pocomos_id, year, service_count)
            VALUES (${m.id}, ${y}, ${counts[y]})
            ON CONFLICT (pocomos_id, year) DO UPDATE SET service_count = EXCLUDED.service_count
          `;
        }
      }
      tableOk++;
    } else {
      tableNotOk++;
    }
    await sql`
      INSERT INTO mosquito_service_scrape (pocomos_id, table_ok, scraped_at)
      VALUES (${m.id}, ${ok}, NOW())
      ON CONFLICT (pocomos_id) DO UPDATE SET table_ok = EXCLUDED.table_ok, scraped_at = NOW()
    `;
    scrapedThisRun++;
  };

  const result = await fetchPooled(work, scrapeOne, { concurrency: SCRAPE_CONCURRENCY });
  const failed = result.failures.length;

  const coveredRow = (await sql`
    SELECT COUNT(*)::int AS n FROM mosquito_service_scrape
    WHERE pocomos_id = ANY(${[...cohortIds]})
  `) as Array<{ n: number }>;
  const covered = coveredRow[0]?.n ?? 0;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    cohortSize: cohort.length,
    scrapedThisRun,
    tableOk,
    tableNotOk,
    failed,
    covered,
    coveragePct: cohort.length ? Math.round((covered / cohort.length) * 1000) / 10 : 0,
    reachedEnd: !budgetHit && work.length < maxCustomers,
    durationMs: Date.now() - t0,
  };
}

export interface ServiceCountsData {
  /** pocomos_id → { year → completed mosquito service count }. Only scraped, table_ok members. */
  counts: Map<string, Record<number, number>>;
  /** pocomos_ids that have been scraped (any table_ok). */
  scraped: Set<string>;
  /** pocomos_ids scraped with table_ok=true (counts are trustworthy). */
  tableOk: Set<string>;
}

/** Read the counts + coverage tables for the return-rate computation. */
export async function getServiceCountsData(): Promise<ServiceCountsData> {
  await initSchema();
  const countRows = (await sql`
    SELECT pocomos_id, year, service_count FROM mosquito_service_counts
  `) as Array<{ pocomos_id: string; year: number; service_count: number }>;
  const scrapeRows = (await sql`
    SELECT pocomos_id, table_ok FROM mosquito_service_scrape
  `) as Array<{ pocomos_id: string; table_ok: boolean }>;
  const counts = new Map<string, Record<number, number>>();
  for (const r of countRows) {
    const id = String(r.pocomos_id);
    const rec = counts.get(id) ?? {};
    rec[Number(r.year)] = Number(r.service_count);
    counts.set(id, rec);
  }
  const scraped = new Set<string>();
  const tableOk = new Set<string>();
  for (const r of scrapeRows) {
    scraped.add(String(r.pocomos_id));
    if (r.table_ok) tableOk.add(String(r.pocomos_id));
  }
  return { counts, scraped, tableOk };
}
