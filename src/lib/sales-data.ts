import { getSalesSummary, type SalesSummary } from "@/lib/pocomos";
import { listSnapshots } from "@/lib/snapshots";

export type { SalesSummary };

/**
 * Result of the snapshot-first initial load for /sales and /tv/sales.
 *  - source "snapshot": painted from the most recent nightly snapshot (a fast
 *    DB read, no Pocomos calls). The client then revalidates live in the
 *    background via GET /api/sales/live.
 *  - source "live": no snapshot row existed yet, so we built live exactly as
 *    the page did before snapshots.
 */
export type InitialSales =
  | { ok: true; source: "snapshot"; summary: SalesSummary; snapshotDate: string }
  | { ok: true; source: "live"; summary: SalesSummary }
  | { ok: false; error: string };

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/**
 * Coerce a snapshot's raw_json into a complete SalesSummary shape. Older
 * snapshots predate newer fields (e.g. contractTypeGroups), so every field is
 * defaulted rather than assumed. A missing breakdown renders empty until the
 * background live fetch fills it in — this must never throw on partial data.
 */
export function normalizeSummary(raw: unknown): SalesSummary {
  const r = asObj(raw);
  const t = asObj(r.totals);
  const b = asObj(r.buckets);
  const rs = asObj(r.retainedSubtypes);
  const c = asObj(r.cancelled);
  const d = asObj(r.debug);
  const src = asObj(r.source);

  const groups = Array.isArray(r.contractTypeGroups)
    ? (r.contractTypeGroups as unknown[]).map((g) => {
        const go = asObj(g);
        return {
          group: str(go.group, "Other"),
          count: num(go.count),
          members: Array.isArray(go.members)
            ? (go.members as unknown[]).map((m) => {
                const mo = asObj(m);
                return { type: str(mo.type, "(unknown)"), count: num(mo.count) };
              })
            : [],
        };
      })
    : [];

  return {
    asOf: str(r.asOf),
    year: str(r.year, String(new Date().getFullYear())),
    source: {
      kind: "pocomos-api",
      office: str(src.office),
    },
    totals: {
      activeCustomers: num(t.activeCustomers),
      activeServices: num(t.activeServices),
      cancelledCustomers: num(t.cancelledCustomers),
      onHoldCustomers: num(t.onHoldCustomers),
    },
    buckets: {
      NEW: num(b.NEW),
      RETURNING: num(b.RETURNING),
      RETAINED: num(b.RETAINED),
      AT_RISK: num(b.AT_RISK),
      CANCELLED: num(b.CANCELLED),
    },
    retainedSubtypes: {
      auto: num(rs.auto),
      seb: num(rs.seb),
      eb: num(rs.eb),
      renewed: num(rs.renewed),
    },
    cancelled: {
      total: num(c.total),
      thisYear: num(c.thisYear),
      lastYear: num(c.lastYear),
      earlier: num(c.earlier),
      unknown: num(c.unknown),
      byYear:
        c.byYear && typeof c.byYear === "object"
          ? (c.byYear as Record<string, number>)
          : {},
    },
    contractTypeGroups: groups,
    debug: {
      untagged: num(d.untagged),
      uncategorized: num(d.uncategorized),
      untaggedSampleIds: strArray(d.untaggedSampleIds),
      uncategorizedSampleIds: strArray(d.uncategorizedSampleIds),
      contractsFetched: num(d.contractsFetched),
      contractsFailed: num(d.contractsFailed),
      tagsFetched: num(d.tagsFetched),
      tagsFailed: num(d.tagsFailed),
      fetchDurationMs: num(d.fetchDurationMs),
      activeAllStatuses: num(d.activeAllStatuses),
      activeServicesAllStatuses: num(d.activeServicesAllStatuses),
    },
  };
}

/** snapshot_date may hydrate as a JS Date (Neon DATE) or a string — trim to YYYY-MM-DD. */
function toDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

/**
 * Snapshot-first load: paint instantly from the most recent persisted snapshot
 * (one fast DB read). Falls back to a live Pocomos build only when there is no
 * snapshot row yet or the DB read fails.
 */
export async function loadInitialSales(): Promise<InitialSales> {
  try {
    const rows = await listSnapshots(1);
    const row = rows[0];
    if (row && row.raw_json != null) {
      return {
        ok: true,
        source: "snapshot",
        summary: normalizeSummary(row.raw_json),
        snapshotDate: toDateString(row.snapshot_date),
      };
    }
  } catch {
    // DB unavailable or snapshot read failed — fall through to a live build.
  }

  try {
    const summary = await getSalesSummary();
    return { ok: true, source: "live", summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
