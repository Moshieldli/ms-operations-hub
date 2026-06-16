/**
 * Probe 3. READ-ONLY.
 *  A) Can /customer/find-customer-by-office return external_account_id in BULK
 *     (so direct-ID match against external customer numbers is feasible without
 *     1 call per customer)? Try a few suggest forms.
 *  B) Does the current-year tag gate keep Igor (1217555)? Pull his contracts +
 *     per-contract tags and print them.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-extnum-tags.ts
 */
import { getJson, fetchContractsForCustomers, fetchTagsForPestContracts, CURRENT_YEAR } from "../src/lib/pocomos";

interface FindResp {
  results?: Array<{ id?: string | number; external_account_id?: string; label?: string }>;
}

(async () => {
  console.log(`CURRENT_YEAR = ${CURRENT_YEAR}`);

  // A) find-customer-by-office bulk feasibility
  for (const suggest of ["198709", "a", "", "e"]) {
    try {
      const resp = await getJson<FindResp>(
        `/customer/find-customer-by-office?suggest=${encodeURIComponent(suggest)}&active=1`
      );
      const n = resp.results?.length ?? 0;
      const first = resp.results?.[0];
      console.log(
        `find-customer suggest=${JSON.stringify(suggest)} -> ${n} results; first=` +
          JSON.stringify(first)
      );
    } catch (e) {
      console.log(`find-customer suggest=${JSON.stringify(suggest)} -> ERROR ${(e as Error).message}`);
    }
  }

  // B) Igor tag gate
  const cr = await fetchContractsForCustomers([1217555]);
  const contracts = cr.results.get(1217555) ?? cr.results.get("1217555" as unknown as number) ?? [];
  console.log(`\nIgor contracts: ${contracts.length}`);
  const pestIds: Array<string | number> = [];
  for (const c of contracts) {
    const pid = (c.pest_contract as { id?: string | number } | undefined)?.id;
    if (pid != null) pestIds.push(pid);
  }
  const tr = await fetchTagsForPestContracts(pestIds);
  const union = new Set<string>();
  for (const pid of pestIds) for (const t of tr.results.get(pid) ?? []) union.add(t);
  const tags = Array.from(union);
  const hasCurrentYear = tags.some((t) => t.trim().startsWith(`${CURRENT_YEAR} -`));
  console.log(`Igor union tags: ${JSON.stringify(tags)}`);
  console.log(`Igor has current-year ("${CURRENT_YEAR} -") tag? ${hasCurrentYear}`);

  console.log("\nDONE");
})();
