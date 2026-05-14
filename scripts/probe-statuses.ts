/** Dump distinct customer status values + counts. */
import { fetchAllCustomers } from "../src/lib/pocomos";

(async () => {
  const all = await fetchAllCustomers();
  const counts = new Map<string, number>();
  for (const c of all) {
    const s = String(c.status || "(empty)").trim();
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`Total: ${all.length}`);
  for (const [s, n] of sorted) console.log(`  ${s}: ${n}`);
})();
