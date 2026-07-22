/**
 * Functional test of the balance-clearance lib (rev 55) against real Neon.
 *   1. initSchema creates balance_clearances + the dedupe index.
 *   2. runCollectionsCheck() live — expect 0 clears (probe showed none pending).
 *   3. logClearances idempotency: same synthetic customer twice → second no-op.
 *   4. listClearancesSince returns the synthetic row; test rows deleted after.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-clearance-lib.ts
 */
import { initSchema, sql } from "../src/lib/db";
import {
  logClearances,
  listClearancesSince,
  runCollectionsCheck,
} from "../src/lib/finance/clearances";

const TEST_ID = "TEST-CLEARANCE-0";

(async () => {
  await initSchema();
  console.log("schema OK (balance_clearances created)");

  const check = await runCollectionsCheck();
  console.log(
    `collections-check: ok=${check.ok} busy=${check.busy ?? false} cleared=${check.cleared.length} partials=${check.partials.length} tookMs=${check.tookMs}`
  );

  await sql`DELETE FROM balance_clearances WHERE pocomos_id = ${TEST_ID}`;
  const first = await logClearances(
    [{ pocomosId: TEST_ID, fullName: "Test Person", amount: 123.45 }],
    "collections"
  );
  const second = await logClearances(
    [{ pocomosId: TEST_ID, fullName: "Test Person", amount: 123.45 }],
    "refresh"
  );
  console.log(
    `dedupe: first insert=${first.length} (expect 1), second insert=${second.length} (expect 0)`
  );

  const since = new Date(Date.now() - 60_000).toISOString();
  const listed = await listClearancesSince(since);
  const found = listed.find((c) => c.pocomosId === TEST_ID);
  console.log(
    `listClearancesSince: ${listed.length} rows, test row found=${Boolean(found)} amount=${found?.amountCleared}`
  );

  await sql`DELETE FROM balance_clearances WHERE pocomos_id = ${TEST_ID}`;
  console.log("test rows cleaned up");

  const pass = first.length === 1 && second.length === 0 && Boolean(found) && check.ok;
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
