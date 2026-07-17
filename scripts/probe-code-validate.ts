/** READ-ONLY: validate the RealGreen ProgramOrServiceCode → service mapping by
 *  cross-tabulating, for customers present in BOTH years, their 2024 RG code(s)
 *  against their 2025 Pocomos Agreement(s). If 12↔Mosquito / 12N↔Natural /
 *  24↔Tick holds, the mapping is confirmed empirically rather than assumed. */
import { readFileSync } from "node:fs";
const splitLines = (r: string) => r.split(/\r\r|\r\n|\n|\r/).filter((l) => l.trim());
function parseRow(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

const a = splitLines(readFileSync("data/completed_jobs_2025.csv", "utf8"));
const ah = parseRow(a[0]); const ai = (n: string) => ah.findIndex((h) => h.trim() === n);
const b = splitLines(readFileSync("data/realgreen_jobs_2024.csv", "utf8"));
const bh = parseRow(b[0]); const bi = (n: string) => bh.findIndex((h) => h.trim() === n);

// short id → set of 2025 agreements
const agree = new Map<string, Set<string>>();
for (const l of a.slice(1)) {
  const r = parseRow(l);
  const id = (r[ai("Customer Id")] || "").trim();
  const ag = (r[ai("Agreement")] || "").trim();
  if (!id || !ag) continue;
  agree.set(id, (agree.get(id) || new Set()).add(ag));
}
// short id → set of 2024 codes
const codes = new Map<string, Set<string>>();
for (const l of b.slice(1)) {
  const r = parseRow(l);
  const id = (r[bi("CustomerNumber")] || "").trim();
  const cd = (r[bi("ProgramOrServiceCode")] || "").trim();
  if (!id || !cd) continue;
  codes.set(id, (codes.get(id) || new Set()).add(cd));
}

// Cross-tab: for customers with EXACTLY ONE 2024 code and EXACTLY ONE 2025 agreement.
const xt = new Map<string, Map<string, number>>();
let clean = 0;
for (const [id, cs] of codes) {
  const ag = agree.get(id);
  if (!ag || cs.size !== 1 || ag.size !== 1) continue;
  clean++;
  const c = [...cs][0]; const g = [...ag][0];
  const row = xt.get(c) || new Map<string, number>();
  row.set(g, (row.get(g) || 0) + 1);
  xt.set(c, row);
}
console.log(`unambiguous customers in BOTH years (1 code, 1 agreement): ${clean}\n`);
console.log(`RealGreen 2024 code  →  Pocomos 2025 Agreement (customer counts)`);
for (const [c, row] of [...xt.entries()].sort()) {
  console.log(`\n  ${c}:`);
  for (const [g, n] of [...row.entries()].sort((x, y) => y[1] - x[1]))
    console.log(`      ${String(n).padStart(4)}  ${g}`);
}
// Per-job volume shape by month, to sanity-check 12 = the main mosquito program.
console.log(`\n--- 2024 job volume by month, per code (mosquito is seasonal: peaks Jun-Aug) ---`);
const mon = new Map<string, number[]>();
for (const l of b.slice(1)) {
  const r = parseRow(l);
  const cd = (r[bi("ProgramOrServiceCode")] || "").trim();
  const d = (r[bi("DoneDate")] || "").trim();
  const m = d.match(/^(\d{1,2})\//);
  if (!cd || !m) continue;
  const arr = mon.get(cd) || new Array(12).fill(0);
  arr[parseInt(m[1], 10) - 1]++;
  mon.set(cd, arr);
}
console.log(`  code  ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((s) => s.padStart(5)).join("")}`);
for (const [c, arr] of [...mon.entries()].sort())
  console.log(`  ${c.padEnd(5)} ${arr.map((n) => String(n).padStart(5)).join("")}`);
