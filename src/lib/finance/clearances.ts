/**
 * Balance-clearance detection + log (rev 55). DISPLAY-ONLY — the hub never
 * touches payments and never writes to Pocomos.
 *
 * A "clearance" = a customer whose stored open_balance was > 0 and whose fresh
 * Unpaid-Invoices balance is exactly $0 — a FULL clear. Partial payments
 * (balance drops but stays > 0) are recorded as a balance update, never
 * celebrated. Detection runs in two places, both funneling through here:
 *
 *   1. refreshMosquitoStatus (06:00 cron + "Refresh now") — diffs the prior
 *      per-customer balances against the fresh pull, source='refresh'.
 *   2. POST /api/finance/collections-check (Collections Mode on /finance) —
 *      a lightweight fresh Unpaid-Invoices pull (~2.5-3.5s measured) diffed
 *      against the paused roster only, source='collections'. No full refresh.
 *
 * Ring-once idempotency = the per-day unique index on balance_clearances
 * (pocomos_id, UTC day) + ON CONFLICT DO NOTHING: whichever path sees the
 * clear first logs it; every other observer conflicts and stays silent.
 * Additionally the collections path zeroes the stored open_balance (status →
 * 'cleared_balance'), so the nightly diff's prior state is already 0.
 *
 * False-positive guards (a wrong celebration is worse than a missed one):
 *   - an EMPTY unpaid report (0 parsed customers) aborts detection — that's a
 *     broken/blank report shell, not 63 simultaneous payments;
 *   - the refresh path only considers customers still in the eligible set
 *     (cancelled / ineligible rows are pruned, so a vanished row never rings);
 *   - full clears only (>0 → exactly 0) — partials never celebrate.
 */
import { initSchema, sql } from "@/lib/db";
import { fetchOpenBalances } from "@/lib/service/openBalance";

export interface Clearance {
  id: number;
  pocomosId: string;
  fullName: string | null;
  amountCleared: number;
  detectedAt: string;
  source: string;
}

export interface ClearanceCandidate {
  pocomosId: string;
  fullName: string | null;
  amount: number;
}

type Row = {
  id: number;
  pocomos_id: string;
  full_name: string | null;
  amount_cleared: string | number;
  detected_at: string;
  source: string;
};

const toClearance = (r: Row): Clearance => ({
  id: Number(r.id),
  pocomosId: String(r.pocomos_id),
  fullName: r.full_name,
  amountCleared: Number(r.amount_cleared),
  detectedAt:
    (r.detected_at as unknown) instanceof Date
      ? (r.detected_at as unknown as Date).toISOString()
      : String(r.detected_at),
  source: r.source,
});

/**
 * Insert candidates; the per-day unique index silently drops ones already
 * logged today. Returns ONLY the freshly-inserted rows — the ones that get to
 * ring the register.
 */
export async function logClearances(
  candidates: ClearanceCandidate[],
  source: "refresh" | "collections"
): Promise<Clearance[]> {
  const inserted: Clearance[] = [];
  for (const c of candidates) {
    const rows = (await sql`
      INSERT INTO balance_clearances (pocomos_id, full_name, amount_cleared, source)
      VALUES (${c.pocomosId}, ${c.fullName}, ${c.amount}, ${source})
      ON CONFLICT (pocomos_id, ((detected_at AT TIME ZONE 'UTC')::date)) DO NOTHING
      RETURNING id, pocomos_id, full_name, amount_cleared, detected_at::text, source
    `) as Row[];
    if (rows.length) inserted.push(toClearance(rows[0]));
  }
  return inserted;
}

/** Clearances newer than `sinceIso` (or the last 30 days when null), oldest first. */
export async function listClearancesSince(sinceIso: string | null): Promise<Clearance[]> {
  await initSchema();
  const rows = (sinceIso
    ? await sql`
        SELECT id, pocomos_id, full_name, amount_cleared, detected_at::text, source
        FROM balance_clearances
        WHERE detected_at > ${sinceIso}::timestamptz
        ORDER BY detected_at ASC
        LIMIT 100`
    : await sql`
        SELECT id, pocomos_id, full_name, amount_cleared, detected_at::text, source
        FROM balance_clearances
        WHERE detected_at > NOW() - INTERVAL '30 days'
        ORDER BY detected_at ASC
        LIMIT 100`) as Row[];
  return rows.map(toClearance);
}

export interface CollectionsCheckResult {
  ok: boolean;
  /** True when another check was already running — caller should just skip this tick. */
  busy?: boolean;
  error?: string;
  /** Full clears found this check. `fresh` = first observer (ring the register). */
  cleared: Array<{ pocomosId: string; fullName: string | null; amount: number; fresh: boolean }>;
  /** Partial payments — stored balance updated, no celebration. */
  partials: Array<{ pocomosId: string; balance: number }>;
  tookMs: number;
}

const LOCK_KEY = "collections_check_lock";
/** A second check starting within this window is told "busy" instead of double-pulling. */
const LOCK_MS = 10_000;

/**
 * One Collections-Mode check: fresh Unpaid-Invoices pull, diffed against the
 * paused roster, clears logged + stored rows updated so every later observer
 * (another tab, the nightly refresh) sees balance 0 instead of re-detecting.
 * Cost measured 2026-07-22: ~2.4-3.4s per pull (token GET + report POST).
 */
export async function runCollectionsCheck(): Promise<CollectionsCheckResult> {
  const t0 = Date.now();
  await initSchema();

  // Short soft-lock so two staff polling at once don't double-hit Pocomos.
  const lockRows = (await sql`
    SELECT value FROM sync_state WHERE key = ${LOCK_KEY}
  `) as Array<{ value: { startedAt?: string } }>;
  const lockStarted = lockRows[0]?.value?.startedAt;
  if (lockStarted && Date.now() - new Date(lockStarted).getTime() < LOCK_MS) {
    return { ok: true, busy: true, cleared: [], partials: [], tookMs: Date.now() - t0 };
  }
  await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (${LOCK_KEY}, ${JSON.stringify({ startedAt: new Date().toISOString() })}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  try {
    const paused = (await sql`
      SELECT pocomos_id, full_name, open_balance
      FROM mosquito_service_status
      WHERE status = 'paused_balance' AND open_balance > 0
    `) as Array<{ pocomos_id: string; full_name: string | null; open_balance: string | number }>;
    if (paused.length === 0) {
      return { ok: true, cleared: [], partials: [], tookMs: Date.now() - t0 };
    }

    const fresh = await fetchOpenBalances();
    // GUARD: an empty report is a broken shell, not a mass payment — never
    // clear anyone off the back of it.
    if (fresh.byId.size === 0) {
      return {
        ok: false,
        error: "unpaid report came back empty — skipped (no clears logged)",
        cleared: [],
        partials: [],
        tookMs: Date.now() - t0,
      };
    }

    const cleared: CollectionsCheckResult["cleared"] = [];
    const partials: CollectionsCheckResult["partials"] = [];
    for (const p of paused) {
      const stored = Number(p.open_balance);
      const now = fresh.byId.get(String(p.pocomos_id))?.balance ?? 0;
      if (now === 0) {
        const inserted = await logClearances(
          [{ pocomosId: String(p.pocomos_id), fullName: p.full_name, amount: stored }],
          "collections"
        );
        // Zero the stored row so no later observer re-detects. Status moves to
        // 'cleared_balance' (a bucket no roster renders); the next full refresh
        // recomputes their real overdue/current status from scratch.
        await sql`
          UPDATE mosquito_service_status
          SET open_balance = 0, status = 'cleared_balance', reason = 'balance_cleared_collections'
          WHERE pocomos_id = ${String(p.pocomos_id)}
        `;
        cleared.push({
          pocomosId: String(p.pocomos_id),
          fullName: p.full_name,
          amount: stored,
          fresh: inserted.length > 0,
        });
      } else if (now < stored) {
        // Partial payment: keep the roster honest, celebrate nothing.
        await sql`
          UPDATE mosquito_service_status
          SET open_balance = ${now}
          WHERE pocomos_id = ${String(p.pocomos_id)}
        `;
        partials.push({ pocomosId: String(p.pocomos_id), balance: now });
      }
    }
    return { ok: true, cleared, partials, tookMs: Date.now() - t0 };
  } finally {
    await sql`
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (${LOCK_KEY}, ${JSON.stringify({ startedAt: null })}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
}

/**
 * Refresh-path detection (called from refreshMosquitoStatus): diff the PRIOR
 * stored balances (read before the upsert) against the fresh bulk balances.
 * `eligibleIds` scopes out cancelled/ineligible customers — a row that VANISHED
 * from the report because the customer left is not a payment.
 */
export async function detectRefreshClearances(
  prior: Array<{ pocomos_id: string; full_name: string | null; open_balance: number }>,
  newBalanceFor: (id: string) => number,
  reportCustomerCount: number,
  eligibleIds: Set<string>
): Promise<Clearance[]> {
  if (reportCustomerCount === 0) return []; // empty-report guard (see header)
  const candidates: ClearanceCandidate[] = [];
  for (const p of prior) {
    if (p.open_balance <= 0) continue;
    if (!eligibleIds.has(p.pocomos_id)) continue;
    if (newBalanceFor(p.pocomos_id) === 0) {
      candidates.push({ pocomosId: p.pocomos_id, fullName: p.full_name, amount: p.open_balance });
    }
  }
  if (!candidates.length) return [];
  return logClearances(candidates, "refresh");
}
