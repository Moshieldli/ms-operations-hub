/**
 * One-off probe: should we use `pest_contract.service_type` or the
 * agreement name to decide whether a contract is a mosquito contract?
 *
 *   service_type — free-text-ish nested name; suspected typos/drift.
 *   agreement    — id pointing into a structured pick-list (should be clean).
 *
 * Read-only. No Postgres writes. No Pocomos writes. Output is a single
 * markdown report under docs/.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-agreement-vs-servicetype.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fetchAllCustomers,
  getJson,
  getToken,
  pocomosOffice,
} from "../src/lib/pocomos";
import type { PocomosContract, PocomosCustomer } from "../src/lib/pocomos";

// --- Knobs -------------------------------------------------------------------

const CONTRACT_CONCURRENCY = 20;
const BATCH_PAUSE_MS = 300;

// --- Field helpers (defensive — Pocomos shapes vary) -------------------------

function strOrEmpty(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function pickServiceType(pc: PocomosContract["pest_contract"]): string {
  const t = (pc as Record<string, unknown> | undefined)?.service_type;
  if (t == null) return "";
  if (typeof t === "string") return t.trim();
  if (typeof t === "object") {
    const name = (t as Record<string, unknown>).name;
    if (name != null) return String(name).trim();
  }
  return "";
}

function pickServiceFrequency(c: PocomosContract): string {
  const pc = c.pest_contract as Record<string, unknown> | undefined;
  const f = pc?.service_frequency ?? (c as Record<string, unknown>).service_frequency;
  return strOrEmpty(f);
}

/** Pull an agreement id off a contract. Some surfaces return a scalar, others
 *  return `{ id, name, ... }`. Some return `agreement_id` instead. */
function pickAgreementId(c: PocomosContract): string {
  const rec = c as Record<string, unknown>;
  const ag = rec.agreement;
  if (ag != null) {
    if (typeof ag === "object") {
      const id = (ag as Record<string, unknown>).id;
      if (id != null && String(id).trim()) return String(id).trim();
    } else {
      const s = String(ag).trim();
      if (s) return s;
    }
  }
  const aid = rec.agreement_id;
  if (aid != null && String(aid).trim()) return String(aid).trim();
  // Sometimes nested into pest_contract.
  const pc = rec.pest_contract as Record<string, unknown> | undefined;
  if (pc) {
    const pag = pc.agreement;
    if (pag != null) {
      if (typeof pag === "object") {
        const id = (pag as Record<string, unknown>).id;
        if (id != null) return String(id).trim();
      } else {
        const s = String(pag).trim();
        if (s) return s;
      }
    }
    const paid = pc.agreement_id;
    if (paid != null && String(paid).trim()) return String(paid).trim();
  }
  return "";
}

function contractId(c: PocomosContract): string {
  return strOrEmpty((c as Record<string, unknown>).id);
}

function contractStatusLower(c: PocomosContract): string {
  return strOrEmpty(c.status).toLowerCase();
}

function customerName(c: PocomosCustomer): string {
  const first = pickString(c as Record<string, unknown>, "firstName", "first_name");
  const last = pickString(c as Record<string, unknown>, "lastName", "last_name");
  const joined = [first, last].filter(Boolean).join(" ").trim();
  if (joined) return joined;
  return (
    pickString(c as Record<string, unknown>, "name", "customerName", "customer_name") ||
    String(c.id)
  );
}

// --- Agreement catalog --------------------------------------------------------

interface AgreementEntry {
  id: string;
  name: string;
}

/** Tries to coerce the `/agreements` envelope into id→name. */
function buildAgreementMap(payload: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const rows: unknown[] =
    Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { response?: unknown[] })?.response)
      ? (payload as { response: unknown[] }).response
      : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = strOrEmpty(r.id ?? r.agreement_id);
    if (!id) continue;
    const name =
      strOrEmpty(r.name) ||
      strOrEmpty(r.agreement_name) ||
      strOrEmpty(r.title) ||
      strOrEmpty(r.label);
    map.set(id, name || `(agreement ${id})`);
  }
  return map;
}

// --- Batched contracts fetch (20 concurrent / 300ms pause) -------------------

interface ContractsEnvelope {
  response?: PocomosContract[];
}

async function fetchContractsForCustomer(
  customerId: string | number
): Promise<PocomosContract[]> {
  const token = await getToken();
  const base = process.env.POCOMOS_BASE || "https://mypocomos.net";
  const url = `${base}/jwt/pronexis/${pocomosOffice()}/customer/${customerId}/contracts`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(url, {
      headers: { XauthToken: token, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as ContractsEnvelope;
    return Array.isArray(body.response) ? body.response : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchContractsBatched(
  customers: PocomosCustomer[]
): Promise<Map<string | number, PocomosContract[]>> {
  const out = new Map<string | number, PocomosContract[]>();
  for (let i = 0; i < customers.length; i += CONTRACT_CONCURRENCY) {
    const batch = customers.slice(i, i + CONTRACT_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (c) => {
        const list = await fetchContractsForCustomer(c.id);
        return { id: c.id, list };
      })
    );
    for (const { id, list } of settled) out.set(id, list);
    if (i + CONTRACT_CONCURRENCY < customers.length) {
      await sleep(BATCH_PAUSE_MS);
    }
    if (((i / CONTRACT_CONCURRENCY) | 0) % 5 === 0) {
      process.stdout.write(
        `  contracts: ${Math.min(i + CONTRACT_CONCURRENCY, customers.length)}/${customers.length}\n`
      );
    }
  }
  return out;
}

// --- Report types ------------------------------------------------------------

interface ContractRow {
  customer_id: string;
  customer_name: string;
  contract_id: string;
  agreement_id: string;
  agreement_name: string;
  service_type: string;
  service_frequency: string;
}

// --- Markdown helpers --------------------------------------------------------

function escapeCell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: string[][]): string {
  const out: string[] = [];
  out.push(`| ${headers.map(escapeCell).join(" | ")} |`);
  out.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) out.push(`| ${r.map(escapeCell).join(" | ")} |`);
  return out.join("\n");
}

function nearDuplicateGroupKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --- Main --------------------------------------------------------------------

(async () => {
  const t0 = Date.now();
  const office = pocomosOffice();
  console.log(`Probe: agreement vs pest_contract.service_type (office ${office})`);

  console.log("\n[1/4] auth + customer list");
  const all = await fetchAllCustomers();
  const active = all.filter((c) => strOrEmpty(c.status) === "Active");
  console.log(`  total customers: ${all.length}`);
  console.log(`  active customers: ${active.length}`);

  console.log("\n[2/4] agreement catalog");
  const agreementsPayload = await getJson<unknown>(
    `/jwt/pronexis/${office}/agreements`
  );
  const agreementMap = buildAgreementMap(agreementsPayload);
  console.log(`  agreement entries: ${agreementMap.size}`);

  console.log(
    `\n[3/4] contracts for ${active.length} active customers ` +
      `(${CONTRACT_CONCURRENCY} concurrent, ${BATCH_PAUSE_MS}ms pause)`
  );
  const contractsByCustomer = await fetchContractsBatched(active);

  console.log("\n[4/4] flattening + analysis");
  const rows: ContractRow[] = [];
  let activeContractCount = 0;
  for (const cust of active) {
    const list = contractsByCustomer.get(cust.id) || [];
    for (const c of list) {
      if (contractStatusLower(c) !== "active") continue;
      activeContractCount++;
      const aid = pickAgreementId(c);
      rows.push({
        customer_id: String(cust.id),
        customer_name: customerName(cust),
        contract_id: contractId(c),
        agreement_id: aid,
        agreement_name: aid ? agreementMap.get(aid) ?? "(unknown agreement)" : "",
        service_type: pickServiceType(c.pest_contract),
        service_frequency: pickServiceFrequency(c),
      });
    }
  }

  // --- Summary stats ---------------------------------------------------------

  const totalActiveCustomers = active.length;
  const totalActiveContracts = activeContractCount;
  const bothPopulated = rows.filter(
    (r) => r.agreement_id && r.service_type
  ).length;
  const blankServiceType = rows.filter((r) => !r.service_type).length;
  const blankAgreement = rows.filter((r) => !r.agreement_id).length;

  // --- Distributions ---------------------------------------------------------

  const stCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.service_type || "(blank)";
    stCounts.set(k, (stCounts.get(k) || 0) + 1);
  }
  const stSorted = [...stCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Near-duplicates: group by lowercase+collapsed-whitespace.
  const stNearDup = new Map<string, string[]>();
  for (const [k] of stSorted) {
    if (k === "(blank)") continue;
    const g = nearDuplicateGroupKey(k);
    const arr = stNearDup.get(g) || [];
    arr.push(k);
    stNearDup.set(g, arr);
  }
  const nearDupGroups = [...stNearDup.entries()].filter(([, v]) => v.length > 1);

  const agCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.agreement_name || "(blank)";
    agCounts.set(k, (agCounts.get(k) || 0) + 1);
  }
  const agSorted = [...agCounts.entries()].sort((a, b) => b[1] - a[1]);

  // --- Cross-tabulation ------------------------------------------------------

  const cross = new Map<string, Map<string, number>>(); // agreement → service_type → count
  const stColumnSet = new Set<string>();
  for (const r of rows) {
    const ag = r.agreement_name || "(blank)";
    const st = r.service_type || "(blank)";
    stColumnSet.add(st);
    let inner = cross.get(ag);
    if (!inner) {
      inner = new Map<string, number>();
      cross.set(ag, inner);
    }
    inner.set(st, (inner.get(st) || 0) + 1);
  }
  const stColumns = [...stColumnSet].sort((a, b) => {
    // most-common service_types first; blank last
    const ca = stCounts.get(a) || 0;
    const cb = stCounts.get(b) || 0;
    return cb - ca;
  });
  const agRowsOrdered = [...cross.keys()].sort((a, b) => {
    return (agCounts.get(b) || 0) - (agCounts.get(a) || 0);
  });

  // --- Disagreement detection ------------------------------------------------

  // Heuristic: per agreement, find the dominant service_type (mode). Any row
  // whose service_type ≠ dominant is "inconsistent with the agreement".
  // Skip agreements where the dominant share is <60% (too noisy to call).
  const agDominant = new Map<string, { st: string; share: number }>();
  for (const ag of cross.keys()) {
    const inner = cross.get(ag)!;
    const total = [...inner.values()].reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const entries = [...inner.entries()]
      .filter(([k]) => k !== "(blank)")
      .sort((a, b) => b[1] - a[1]);
    if (!entries.length) continue;
    const [topSt, topCount] = entries[0];
    agDominant.set(ag, { st: topSt, share: topCount / total });
  }
  const disagreements: ContractRow[] = [];
  for (const r of rows) {
    const ag = r.agreement_name || "(blank)";
    const dom = agDominant.get(ag);
    if (!dom || dom.share < 0.6) continue;
    if (!r.service_type) continue;
    if (r.service_type === dom.st) continue;
    disagreements.push(r);
  }
  const disagreementSample = disagreements.slice(0, 10);

  // --- Recommendation --------------------------------------------------------

  // Mosquito-detection cleanliness:
  // - service_type mosquito-ish matches (case-insensitive contains "mosquito")
  // - agreement_name mosquito-ish matches
  const stMosquito = rows.filter((r) =>
    /mosquito/i.test(r.service_type)
  ).length;
  const agMosquito = rows.filter((r) => /mosquito/i.test(r.agreement_name)).length;

  // Distinct casings for "mosquito" in service_type vs distinct agreement names
  // containing "mosquito".
  const stMosquitoVariants = new Set<string>();
  for (const r of rows) {
    if (/mosquito/i.test(r.service_type)) stMosquitoVariants.add(r.service_type);
  }
  const agMosquitoVariants = new Set<string>();
  for (const r of rows) {
    if (/mosquito/i.test(r.agreement_name)) agMosquitoVariants.add(r.agreement_name);
  }

  // --- Build markdown --------------------------------------------------------

  const date = todayLocal();
  const lines: string[] = [];
  lines.push(`# Probe: agreement vs pest_contract.service_type`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} — office ${office}_`);
  lines.push("");
  lines.push(
    `Read-only probe. Fetches all active customers, their active contracts, ` +
      `and the agreement catalog, then compares ` +
      `\`pest_contract.service_type\` against the agreement name to decide ` +
      `which field should be the source of truth for "is this a mosquito contract?".`
  );
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- Total active customers: **${totalActiveCustomers}**`);
  lines.push(`- Total active contracts: **${totalActiveContracts}**`);
  lines.push(`- Contracts with BOTH fields populated: **${bothPopulated}**`);
  lines.push(
    `- Contracts with \`service_type\` blank/null: **${blankServiceType}** ` +
      `(${totalActiveContracts ? ((blankServiceType / totalActiveContracts) * 100).toFixed(1) : "0.0"}%)`
  );
  lines.push(
    `- Contracts with \`agreement_id\` blank/null: **${blankAgreement}** ` +
      `(${totalActiveContracts ? ((blankAgreement / totalActiveContracts) * 100).toFixed(1) : "0.0"}%)`
  );
  lines.push(`- Agreement catalog entries: **${agreementMap.size}**`);
  lines.push("");

  lines.push(`## Distribution of pest_contract.service_type`);
  lines.push("");
  lines.push(
    table(
      ["value (raw, exact casing)", "count"],
      stSorted.map(([k, n]) => [k, String(n)])
    )
  );
  lines.push("");
  if (nearDupGroups.length) {
    lines.push(`### Near-duplicate service_type values`);
    lines.push("");
    lines.push(`Values that collapse to the same lowercase+trimmed key:`);
    lines.push("");
    for (const [g, members] of nearDupGroups) {
      lines.push(
        `- \`${g}\` → ${members.map((m) => `"${m}" (${stCounts.get(m) || 0})`).join(", ")}`
      );
    }
    lines.push("");
  } else {
    lines.push(`_No near-duplicate casing/whitespace variants detected._`);
    lines.push("");
  }

  lines.push(`## Distribution of agreement names`);
  lines.push("");
  lines.push(
    table(
      ["agreement_name", "count"],
      agSorted.map(([k, n]) => [k, String(n)])
    )
  );
  lines.push("");

  lines.push(`## Cross-tabulation (agreement_name × service_type)`);
  lines.push("");
  lines.push(`Counts of active contracts in each cell. Rows = agreement name, columns = service_type.`);
  lines.push("");
  {
    const headers = ["agreement_name", ...stColumns, "TOTAL"];
    const tableRows: string[][] = [];
    for (const ag of agRowsOrdered) {
      const inner = cross.get(ag)!;
      let total = 0;
      const cells = stColumns.map((st) => {
        const n = inner.get(st) || 0;
        total += n;
        return n ? String(n) : "";
      });
      tableRows.push([ag, ...cells, String(total)]);
    }
    lines.push(table(headers, tableRows));
  }
  lines.push("");

  lines.push(`## Disagreement examples`);
  lines.push("");
  if (!disagreementSample.length) {
    lines.push(
      `_No disagreements detected — every populated service_type matches its agreement's dominant service_type (≥60% mode threshold)._`
    );
  } else {
    lines.push(
      `Heuristic: for each agreement, the dominant (mode) service_type is treated as "expected". ` +
        `Rows below have a populated service_type that disagrees with the dominant for their agreement. ` +
        `${disagreements.length} total such rows; showing first 10.`
    );
    lines.push("");
    lines.push(
      table(
        [
          "customer_id",
          "contract_id",
          "customer_name",
          "agreement_name",
          "service_type",
          "expected (dominant)",
        ],
        disagreementSample.map((r) => [
          r.customer_id,
          r.contract_id,
          r.customer_name,
          r.agreement_name,
          r.service_type,
          agDominant.get(r.agreement_name)?.st ?? "",
        ])
      )
    );
  }
  lines.push("");

  lines.push(`## Recommendation`);
  lines.push("");
  lines.push(`### Mosquito detection on each surface`);
  lines.push("");
  lines.push(
    `- Contracts matching \`/mosquito/i\` on \`service_type\`: **${stMosquito}** ` +
      `(${stMosquitoVariants.size} distinct raw values${
        stMosquitoVariants.size ? ": " + [...stMosquitoVariants].map((v) => `"${v}"`).join(", ") : ""
      })`
  );
  lines.push(
    `- Contracts matching \`/mosquito/i\` on \`agreement_name\`: **${agMosquito}** ` +
      `(${agMosquitoVariants.size} distinct agreement names${
        agMosquitoVariants.size ? ": " + [...agMosquitoVariants].map((v) => `"${v}"`).join(", ") : ""
      })`
  );
  lines.push("");

  // Pick the recommended field based on cleanliness signals.
  const serviceTypeCleanish =
    blankServiceType === 0 &&
    nearDupGroups.length === 0 &&
    stMosquitoVariants.size <= 1;
  const agreementCleanish =
    blankAgreement === 0 && agMosquitoVariants.size >= 1;

  let recommended: "agreement" | "service_type";
  const reasons: string[] = [];
  if (agreementCleanish && !serviceTypeCleanish) {
    recommended = "agreement";
    reasons.push(
      "Agreement is a structured pick-list — no blanks observed and a small, enumerable set of mosquito-bearing agreement names."
    );
    if (nearDupGroups.length) {
      reasons.push(
        `service_type has ${nearDupGroups.length} near-duplicate group(s) (casing/whitespace drift).`
      );
    }
    if (stMosquitoVariants.size > 1) {
      reasons.push(
        `service_type has ${stMosquitoVariants.size} distinct "mosquito" spellings — fragile to match against.`
      );
    }
    if (blankServiceType > 0) {
      reasons.push(
        `${blankServiceType} active contract(s) have blank service_type but a populated agreement.`
      );
    }
  } else if (serviceTypeCleanish && !agreementCleanish) {
    recommended = "service_type";
    reasons.push(
      "service_type is fully populated and shows no casing/whitespace drift; agreement coverage is incomplete."
    );
  } else if (blankAgreement < blankServiceType) {
    recommended = "agreement";
    reasons.push(
      `Agreement has fewer blanks (${blankAgreement}) than service_type (${blankServiceType}); both have some drift but agreement is the more reliable signal.`
    );
  } else {
    recommended = "service_type";
    reasons.push(
      `service_type has fewer or equal blanks (${blankServiceType}) compared to agreement (${blankAgreement}); use it as primary and reconcile by hand.`
    );
  }

  lines.push(`### Recommended source of truth: \`${recommended}\``);
  lines.push("");
  for (const r of reasons) lines.push(`- ${r}`);
  lines.push("");

  lines.push(`### Suggested filter logic`);
  lines.push("");
  if (recommended === "agreement") {
    const list = [...agMosquitoVariants];
    lines.push(`Treat a contract as a mosquito contract iff its agreement name matches:`);
    lines.push("");
    lines.push("```ts");
    lines.push(`const MOSQUITO_AGREEMENTS = new Set<string>([`);
    for (const v of list) lines.push(`  ${JSON.stringify(v)},`);
    lines.push(`]);`);
    lines.push("");
    lines.push(`function isMosquitoContract(contract: PocomosContract, agreementMap: Map<string, string>) {`);
    lines.push(`  const agId = pickAgreementId(contract);`);
    lines.push(`  const agName = agId ? agreementMap.get(agId) ?? "" : "";`);
    lines.push(`  return MOSQUITO_AGREEMENTS.has(agName);`);
    lines.push(`}`);
    lines.push("```");
    lines.push("");
    lines.push(
      `Equivalent loose form: \`/mosquito/i.test(agName)\` — equivalent here because all ${agMosquitoVariants.size} ` +
        `mosquito-bearing agreement names already pass that test, and the catalog is closed.`
    );
  } else {
    lines.push(`Treat a contract as a mosquito contract iff:`);
    lines.push("");
    lines.push("```ts");
    lines.push(`function isMosquitoContract(contract: PocomosContract) {`);
    lines.push(`  const st = (contract.pest_contract?.service_type?.name ?? "").trim();`);
    lines.push(`  return /mosquito/i.test(st);`);
    lines.push(`}`);
    lines.push("```");
    lines.push("");
    lines.push(
      `Use case-insensitive contains to absorb the ${nearDupGroups.length} casing variant(s) found above.`
    );
  }
  lines.push("");

  lines.push(`---`);
  lines.push(`_Probe runtime: ${((Date.now() - t0) / 1000).toFixed(1)}s_`);
  lines.push("");

  const outDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `probe-agreement-vs-servicetype-${date}.md`);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`Recommendation: ${recommended}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
