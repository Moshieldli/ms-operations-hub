/**
 * Technician roster (rev 50) — the compliment dropdown's source of truth.
 *
 * ⚠️ PRIVACY: reads **ONLY column A** ("Last, First" names) of the "Technician &
 * Asset Information - MS" sheet. That sheet also holds credentials and personal
 * data in other columns — this code requests A1:A only and stores nothing but
 * the display name. NEVER widen the range.
 *
 * Everyone on the roster is compliment-eligible, including head techs / mechanics
 * (Barrera, McAuliffe) who remain AWARD-excluded on /tv/techs — recognition and
 * competition are separate.
 */
import { initSchema, sql } from "@/lib/db";
import { hasDriveCredentials, readSheetValues } from "./payrollDrive";

export const TECH_SHEET_ID =
  process.env.TECH_SHEET_ID || "1ZMyQoSfPTx5CaG5LStirz4Fy_eLuSDuCHXvBZSCaW2o";
/** The tab holding the roster (column A). Probed live: "TECHNICIAN INFORMATION". */
export const TECH_SHEET_TAB = process.env.TECH_SHEET_TAB || "TECHNICIAN INFORMATION";

/** "LAST, FIRST" → "First Last"; anything else passes through trimmed. */
export function displayName(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (m) {
    const last = m[1].trim();
    const first = m[2].trim();
    return `${first} ${last}`.replace(/\s+/g, " ").trim();
  }
  return s;
}

/**
 * A real roster entry is "LAST, FIRST" (has a comma with text on both sides).
 * Column A also holds section labels / asset rows ("PERSONAL INFORMATION",
 * "LOCKER 1", "OFFICE SPARE (EMERGENCY ONLY)") — none of which have a comma —
 * so this single test keeps exactly the technician names.
 */
const IS_TECH_NAME = /^[^,]+,\s*\S/;

/**
 * Read column A of the Technician sheet and rebuild `tech_roster`. Names only.
 * No-ops (leaves the roster as-is) without Drive credentials.
 */
export async function refreshTechRoster(): Promise<{ ok: boolean; count: number; reason?: string }> {
  await initSchema();
  if (!hasDriveCredentials()) {
    return { ok: false, count: 0, reason: "Drive credentials not set — roster left as-is." };
  }
  // COLUMN A ONLY. Never widen this range.
  const rows = await readSheetValues(TECH_SHEET_ID, `${TECH_SHEET_TAB}!A1:A200`);
  if (!rows) return { ok: false, count: 0, reason: "roster sheet not readable (share / range)" };

  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    const raw = String(row[0] || "").trim();
    if (!raw || !IS_TECH_NAME.test(raw)) continue;
    const name = displayName(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (names.length === 0) return { ok: false, count: 0, reason: "no names in column A" };

  // Replace the roster wholesale, preserving sheet order.
  await sql`DELETE FROM tech_roster`;
  const order = names.map((_, j) => j);
  await sql`
    INSERT INTO tech_roster (name, sort_order)
    SELECT * FROM UNNEST(${names}::text[], ${order}::int[]) AS u(name, sort_order)
    ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order, refreshed_at = NOW()
  `;
  return { ok: true, count: names.length };
}
