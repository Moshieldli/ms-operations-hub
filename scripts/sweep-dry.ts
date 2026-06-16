/**
 * Idempotency check: a dry sweep AFTER the live run should find ~0 to move
 * (everyone matched is already in Active Customer, out of the policed folders).
 *   $env:PHONEBURNER_TOKEN='...'; node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/sweep-dry.ts
 */
import { runConversionSweep } from "../src/lib/sync/conversionSweep";

(async () => {
  const r = await runConversionSweep({ dryRun: true });
  console.log(
    JSON.stringify(
      {
        scanned: r.scanned,
        matchedById: r.matchedById,
        matchedByPhone: r.matchedByPhone,
        nameMismatchSkipped: r.nameMismatchSkipped,
        wouldMove: r.wouldMove,
        rosterActiveCount: r.rosterActiveCount,
        duration_ms: r.duration_ms,
      },
      null,
      2
    )
  );
})();
