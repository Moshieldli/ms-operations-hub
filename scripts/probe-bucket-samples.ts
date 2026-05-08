/**
 * Dump samples from each bucket to investigate AT_RISK gap (36 vs ~75 expected).
 */
import { fetchTagsCsv, parseTagsCsv } from "../src/lib/sheets";

const SHEET_ID = "1RGPeS5Mir2p3flA9oDOfaxyfC8xfoXyZnoe1kKCL11s";
const TAB = "Tags";
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;
const YEAR = "2026";

(async () => {
  const csv = await fetchTagsCsv(URL);
  const parsed = parseTagsCsv(csv);

  type B = "NEW" | "RETURNING" | "RETAINED" | "AT_RISK" | "UNTAGGED";
  const sample: Record<B, Array<{ id: string; tags: string[]; raw: string[] }>> = {
    NEW: [],
    RETURNING: [],
    RETAINED: [],
    AT_RISK: [],
    UNTAGGED: [],
  };

  for (const c of parsed.customers.values()) {
    if (!c.yearTags.size) {
      if (sample.UNTAGGED.length < 8)
        sample.UNTAGGED.push({
          id: c.customerNumber,
          tags: [],
          raw: c.rawTagsCells,
        });
      continue;
    }
    const t = c.yearTags;
    const hasNew = t.has(`${YEAR} - New Sale`);
    const hasRenewed = t.has(`${YEAR} - Renewed`);
    const hasAuto = t.has(`${YEAR} - Auto`);
    const hasSEB = t.has(`${YEAR} - SEB`);
    const hasEB = t.has(`${YEAR} - EB`);
    const hasOther = t.has(`${YEAR} - Prepaid`) || t.has(`${YEAR} - Committed`);
    const hasCont = hasAuto || hasSEB || hasEB || hasOther;
    const hasPrior = Array.from(t).some((tag) => {
      const m = tag.match(/^(\d{4}) -/);
      return m != null && m[1] < YEAR;
    });

    let bucket: B;
    if (hasNew) bucket = "NEW";
    else if (hasRenewed) bucket = "RETURNING";
    else if (hasCont) bucket = "RETAINED";
    else if (hasPrior) bucket = "AT_RISK";
    else continue;

    if (sample[bucket].length < 8) {
      sample[bucket].push({
        id: c.customerNumber,
        tags: Array.from(t),
        raw: c.rawTagsCells,
      });
    }
  }

  for (const [bucket, items] of Object.entries(sample)) {
    console.log(`\n=== ${bucket} (showing ${items.length}) ===`);
    for (const it of items) {
      console.log(`  ${it.id}`);
      console.log(`    yearTags: [${it.tags.join(", ")}]`);
      console.log(`    raw rows: ${it.raw.map((r) => `"${r.slice(0, 100)}"`).join(" | ")}`);
    }
  }

  // Also: which prior-year tags are most common among AT_RISK?
  const atRiskTagFreq = new Map<string, number>();
  for (const c of parsed.customers.values()) {
    if (!c.yearTags.size) continue;
    const t = c.yearTags;
    const hasNew = t.has(`${YEAR} - New Sale`);
    const hasRenewed = t.has(`${YEAR} - Renewed`);
    const hasAuto = t.has(`${YEAR} - Auto`);
    const hasSEB = t.has(`${YEAR} - SEB`);
    const hasEB = t.has(`${YEAR} - EB`);
    const hasOther = t.has(`${YEAR} - Prepaid`) || t.has(`${YEAR} - Committed`);
    const hasCont = hasAuto || hasSEB || hasEB || hasOther;
    if (hasNew || hasRenewed || hasCont) continue;
    for (const tag of t) {
      atRiskTagFreq.set(tag, (atRiskTagFreq.get(tag) || 0) + 1);
    }
  }
  console.log("\n=== AT_RISK tag frequency (top 20) ===");
  Array.from(atRiskTagFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([tag, count]) => console.log(`  ${count}  ${tag}`));

  // Distribution of all 2026 tags across the sheet
  const tag2026Freq = new Map<string, number>();
  for (const c of parsed.customers.values()) {
    for (const tag of c.yearTags) {
      if (tag.startsWith(`${YEAR} -`)) {
        tag2026Freq.set(tag, (tag2026Freq.get(tag) || 0) + 1);
      }
    }
  }
  console.log("\n=== 2026 tag frequency across all categorized customers ===");
  Array.from(tag2026Freq.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => console.log(`  ${count}  ${tag}`));

  // How many customers have ANY 2026 tag vs only prior-year?
  let any2026 = 0;
  let onlyPriorYear = 0;
  for (const c of parsed.customers.values()) {
    if (!c.yearTags.size) continue;
    const has2026 = Array.from(c.yearTags).some((t) => t.startsWith(`${YEAR} -`));
    if (has2026) any2026++;
    else onlyPriorYear++;
  }
  console.log(`\nCustomers with any 2026 tag: ${any2026}`);
  console.log(`Customers with only prior-year tags (= AT_RISK candidates): ${onlyPriorYear}`);
})();
