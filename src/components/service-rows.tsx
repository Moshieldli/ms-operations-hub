"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MosquitoStatusRow } from "@/lib/service/refresh";

/**
 * Shared row rendering for the mosquito status tables, used by /service/overdue
 * AND /finance. The paused-balance card in particular lives here as
 * `PausedBalanceCard` so both pages render the SAME component (not copied code) —
 * the overdue page keeps the section in place, and Finance reuses it.
 */

export const POCOMOS_BASE = "https://mypocomos.net";

// Row-coloring thresholds (days since last mosquito service). Distinct from the
// 15-day OVERDUE_THRESHOLD_DAYS in mosquito.ts — these only drive the visual tint.
const LATE_DAYS = 17; // 17–20 days → yellow row
const VERY_LATE_DAYS = 21; // 21+ days → red row

export function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "2026-06-09" → "06/09/26" (matches the Pocomos UI short date). */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

export type RowKind = "overdue" | "needsCheck" | "paused";

/**
 * Row tint: sprayed/scheduled today → green, ASAP → blue, else by days since
 * last mosquito service (21+ → red, 17–20 → yellow, <17/unknown → normal).
 */
function rowToneClass(row: MosquitoStatusRow): string {
  if (row.sprayed_today) return "bg-emerald-50 dark:bg-emerald-950/30"; // done today
  if (row.scheduled_today) return "bg-emerald-50 dark:bg-emerald-950/30";
  if (row.asap_route) return "bg-sky-50 dark:bg-sky-950/30"; // being caught up on an ASAP route
  const d = row.days_since;
  if (d == null) return "";
  if (d >= VERY_LATE_DAYS) return "bg-rose-50 dark:bg-rose-950/30";
  if (d >= LATE_DAYS) return "bg-amber-50 dark:bg-amber-950/30";
  return "";
}

export function RowTable({ rows, kind }: { rows: MosquitoStatusRow[]; kind: RowKind }) {
  return (
    <div>
      {/* No overflow wrapper: an overflow-x/-y container becomes the sticky
          scroll context and the header would scroll away. Without it, sticky
          resolves against the page, so the solid-bg header pins on page scroll. */}
      <table className="w-full text-sm">
        <thead className="[&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:z-20 [&>tr>th]:bg-background">
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Route</th>
            <th className="py-2 pr-4 font-medium">Contract</th>
            {kind === "overdue" ? (
              <>
                <th className="py-2 pr-4 font-medium">Last mosquito service</th>
                <th className="py-2 pr-4 text-right font-medium">Days since</th>
              </>
            ) : kind === "paused" ? (
              <th className="py-2 pr-4 text-right font-medium">Balance</th>
            ) : (
              <th className="py-2 pr-4 font-medium">Selected contract</th>
            )}
            <th className="py-2 pr-4 font-medium">Next scheduled</th>
            <th className="py-2 pr-4 font-medium">Sign-up</th>
            <th className="py-2 pl-4 text-right font-medium">Pocomos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pocomos_id} className={`border-b last:border-0 ${rowToneClass(r)}`}>
              <td className="py-2 pr-4 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {r.full_name || r.pocomos_id}
                  {r.is_weekly ? (
                    <span className="rounded-full border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Weekly
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {r.route_code ? r.route_code : "—"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.mosquito_contract_type || "—"}
              </td>
              {kind === "overdue" ? (
                <>
                  <td className="py-2 pr-4 tabular-nums">
                    {r.last_regular_spray ? (
                      shortDate(r.last_regular_spray)
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400">no spray yet</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                    {r.days_since == null ? "—" : fmt(r.days_since)}
                  </td>
                </>
              ) : kind === "paused" ? (
                <td className="py-2 pr-4 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {money(r.open_balance)}
                </td>
              ) : (
                <td className="py-2 pr-4 text-muted-foreground">
                  {r.selected_contract_label || "—"}
                </td>
              )}
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  {shortDate(r.next_service_date)}
                  {r.sprayed_today ? (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Sprayed
                    </span>
                  ) : r.scheduled_today ? (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      Today
                    </span>
                  ) : null}
                  {r.asap_route ? (
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                      ASAP
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {shortDate(r.sign_up_date)}
              </td>
              <td className="py-2 pl-4 text-right">
                {/* needs-check rows link to service HISTORY (to read history &
                    switch the contract); overdue/paused link to the customer
                    PROFILE (service-information). pocomos_id is the 7-digit id. */}
                <a
                  href={`${POCOMOS_BASE}/customer/${r.pocomos_id}/${
                    kind === "needsCheck" ? "service-history" : "service-information"
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {kind === "needsCheck" ? "History" : "Profile"}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "Service paused — open balance" card. Shared by /service/overdue (in-place)
 * and /finance. `asOf` is optional — shown when the caller wants a freshness
 * line (the Finance page passes the report's last refresh).
 */
export function PausedBalanceCard({
  rows,
  asOf,
}: {
  rows: MosquitoStatusRow[];
  asOf?: React.ReactNode;
}) {
  const total = rows.reduce((s, r) => s + r.open_balance, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service paused — open balance</CardTitle>
        <CardDescription>
          Eligible mosquito accounts carrying an open balance. We intentionally
          pause spray on unpaid accounts, so these are kept out of the overdue
          list. Highest balance first.
          {rows.length > 0 ? (
            <>
              {" "}
              <span className="tabular-nums">
                {fmt(rows.length)} account{rows.length === 1 ? "" : "s"} ·{" "}
                {money(total)} outstanding.
              </span>
            </>
          ) : null}
          {asOf ? <> {asOf}</> : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No eligible accounts with an open balance.
          </p>
        ) : (
          <RowTable rows={rows} kind="paused" />
        )}
      </CardContent>
    </Card>
  );
}
