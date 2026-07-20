/**
 * Payroll-sheet ingestion via the Google Drive + Sheets APIs (rev 41).
 *
 * READ-ONLY scopes only:
 *   https://www.googleapis.com/auth/drive.metadata.readonly  (list the folder)
 *   https://www.googleapis.com/auth/spreadsheets.readonly    (read the tabs)
 *
 * NO NEW DEPENDENCY. A service-account JWT is just a signed JSON blob, and Node
 * already ships RS256 signing in `node:crypto`, so pulling in `googleapis`
 * (large, and it drags in its own auth stack) to make three REST calls isn't
 * worth it.
 *
 * ⚠️ DORMANT UNTIL CREDENTIALS EXIST. `hasDriveCredentials()` is false when the
 * env vars are unset and every entry point no-ops with a clear reason rather
 * than throwing — the nightly cron must not fail because an integration hasn't
 * been provisioned. Until then `referral_awards` is filled by the seed/manual
 * path (`scripts/seed-referrals.ts`), and the payroll sheets stay the source of
 * truth either way.
 *
 * ENV:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — the service account's address
 *   GOOGLE_PRIVATE_KEY            — its PEM key (literal \n escapes are handled)
 *   PAYROLL_DRIVE_PARENT_FOLDER_ID — the "Payroll Calculator - MS" PARENT folder
 *                                    (the year subfolder is resolved inside it)
 *   PAYROLL_DRIVE_FOLDER_ID       — OPTIONAL override: a specific year folder to
 *                                    scan directly, skipping year resolution
 */
import { createSign } from "node:crypto";
import { CURRENT_YEAR } from "@/lib/pocomos";
import {
  isReferralRow,
  matchTechnician,
  type PayrollOtherPayRow,
  type Referral,
} from "./referrals";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
].join(" ");

/**
 * The "Payroll Calculator - MS" PARENT folder — the one shared with the service
 * account. Its children are per-year subfolders ("2026", "2027", …) plus a
 * "0-Templates" folder; the year folder is resolved by NAME at runtime (rev 43)
 * so a new January needs zero code/config change — just a new year folder here.
 */
export const DEFAULT_PAYROLL_PARENT = "1EP1fMZrPMaCnx3lY2rt3DYOM-v8kwAwF";

/** The 2026 year subfolder (kept only as the direct-override example / fallback). */
export const DEFAULT_PAYROLL_FOLDER = "1UsODcBn0JsGMEzsZQQ1CmCVMgxe1Z0nM";

export function hasDriveCredentials(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Mint a read-only access token from the service-account key (RS256 JWT grant). */
async function accessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  // Vercel env vars can't hold real newlines, so the PEM arrives escaped.
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(key));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export interface PayrollFile {
  id: string;
  title: string;
  /** Week-ending date parsed from the title, ISO. */
  weekEnding: string | null;
}

/** "MS Payroll Calculator - 2026-07-17" → 2026-07-17. */
export function weekEndingFromTitle(title: string): string | null {
  const m = title.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Resolve the year subfolder INSIDE the parent by exact name (rev 43).
 *
 * `name = '2026'` matches only the year folder, never the sibling "0-Templates",
 * so `January 2027` just works once someone drops a "2027" folder in the parent —
 * no code, no env change. Year is `CURRENT_YEAR` (year-relative rule), overridable
 * via `PAYROLL_DRIVE_YEAR` for a backfill.
 */
export async function resolveYearFolderId(token: string): Promise<string> {
  const year = process.env.PAYROLL_DRIVE_YEAR || CURRENT_YEAR;
  const parent = process.env.PAYROLL_DRIVE_PARENT_FOLDER_ID || DEFAULT_PAYROLL_PARENT;
  const q = encodeURIComponent(
    `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' ` +
      `and name='${year}' and trashed=false`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`drive resolve-year ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  const folder = j.files?.find((f) => f.name === String(year));
  if (!folder) {
    throw new Error(
      `no "${year}" subfolder in the payroll parent (${parent}) — ` +
        `create a "${year}" folder inside "Payroll Calculator - MS" (the yearly ritual).`
    );
  }
  return folder.id;
}

/** The newest `limit` weekly sheets in the CURRENT-year payroll folder, newest first. */
export async function listPayrollFiles(limit = 6): Promise<PayrollFile[]> {
  const token = await accessToken();
  // Direct override (a pinned year folder) skips resolution; otherwise resolve
  // the current year's subfolder by name inside the shared parent.
  const folder = process.env.PAYROLL_DRIVE_FOLDER_ID || (await resolveYearFolderId(token));
  const q = encodeURIComponent(
    `'${folder}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  );
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name)&pageSize=100&orderBy=name desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`drive list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return (j.files || [])
    .map((f) => ({ id: f.id, title: f.name, weekEnding: weekEndingFromTitle(f.name) }))
    .filter((f) => f.weekEnding)
    .sort((a, b) => (b.weekEnding! < a.weekEnding! ? -1 : 1))
    .slice(0, limit);
}

/**
 * Pull every OTHER PAY row out of one payroll spreadsheet.
 *
 * One `values:batchGet` per sheet with `majorDimension=ROWS` over each tab. A
 * tab is one technician; the GROSS PAY block's OTHER PAY rows carry the label,
 * the amount, and the notes in adjacent columns. The label column is found by
 * text, not by a fixed index, because the sheet's merged cells shift columns
 * between weeks.
 */
export async function readOtherPayRows(fileId: string): Promise<PayrollOtherPayRow[]> {
  const token = await accessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(title))`,
    { headers: auth, cache: "no-store" }
  );
  if (!metaRes.ok) throw new Error(`sheets meta ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const tabs = (meta.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[];

  const out: PayrollOtherPayRow[] = [];
  for (const tab of tabs) {
    const range = encodeURIComponent(`${tab}!A1:Z60`);
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}`,
      { headers: auth, cache: "no-store" }
    );
    if (!r.ok) continue;
    const j = (await r.json()) as { values?: string[][] };
    for (const row of j.values || []) {
      const idx = row.findIndex((c) => /TOTAL OTHER PAY/i.test(String(c || "")));
      if (idx < 0) continue;
      // AMOUNT is the next non-empty cell; NOTES the one after it.
      const rest = row.slice(idx + 1).map((c) => String(c || "").trim());
      const amountCell = rest.find((c) => /\$|\d/.test(c)) || "";
      const after = rest.slice(rest.indexOf(amountCell) + 1);
      const notes = (after.find((c) => c && !/^\$?[\d.,]+$/.test(c)) || "").trim();
      const amount = Number(amountCell.replace(/[^0-9.]/g, "")) || 0;
      out.push({ payrollName: tab, amount, notes });
    }
  }
  return out;
}

export interface ScanReport {
  ok: boolean;
  reason?: string;
  filesScanned: number;
  rowsSeen: number;
  referrals: Referral[];
  unmatched: string[];
}

/**
 * Scan the newest `weeks` payroll sheets for referral rows.
 * `knownTechs` comes from the board so payroll names map onto Pocomos spellings.
 */
export async function scanPayrollReferrals(
  knownTechs: string[],
  weeks = 6
): Promise<ScanReport> {
  if (!hasDriveCredentials()) {
    return {
      ok: false,
      reason:
        "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY are not set — payroll scan skipped. " +
        "referral_awards keeps whatever the seed/manual path put there.",
      filesScanned: 0,
      rowsSeen: 0,
      referrals: [],
      unmatched: [],
    };
  }
  const files = await listPayrollFiles(weeks);
  const referrals: Referral[] = [];
  const unmatched: string[] = [];
  let rowsSeen = 0;
  for (const f of files) {
    const rows = await readOtherPayRows(f.id);
    rowsSeen += rows.length;
    for (const row of rows) {
      if (!isReferralRow(row)) continue;
      const tech = matchTechnician(row.payrollName, knownTechs);
      if (!tech) {
        unmatched.push(`${row.payrollName} (${f.title})`);
        continue;
      }
      referrals.push({
        technician: tech,
        customerName: row.notes,
        weekEnding: f.weekEnding!,
        payrollName: row.payrollName,
        sourceFileTitle: f.title,
        source: "payroll",
      });
    }
  }
  return { ok: true, filesScanned: files.length, rowsSeen, referrals, unmatched };
}
