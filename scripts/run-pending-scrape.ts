/**
 * One-off runner for the rev-39 pending-re-service scan (normally a phase of the
 * nightly mosquito-status cron). READ-ONLY against Pocomos; writes only the
 * `pending_reservice` flag. Scoped to customers whose most recent spray is
 * 8-21 days old.
 */
import { sql, initSchema } from "../src/lib/db";
import { getSessionedHtml } from "../src/lib/pocomos/webSession";
import { parseScheduledServices, hasPendingReservice } from "../src/lib/service/serviceHistory";

const today = new Date().toISOString().slice(0, 10);
async function pooled<T>(items: T[], fn: (t: T) => Promise<void>, c = 5) {
  let i = 0; const failures: unknown[] = [];
  await Promise.all(Array.from({ length: c }, async () => {
    while (i < items.length) { const k = i++; try { await fn(items[k]); } catch (e) { failures.push(e); } }
  }));
  return failures;
}
(async () => {
  await initSchema();
  const rows = (await sql`
    WITH last AS (SELECT customer_id, MAX(completed_date) AS d FROM respray_jobs GROUP BY 1)
    SELECT l.customer_id AS id FROM last l
    JOIN mosquito_service_status m ON m.pocomos_id = l.customer_id
    WHERE (CURRENT_DATE - l.d) BETWEEN 8 AND 21
  `) as Array<{ id: string }>;
  console.log(`scope: ${rows.length} customers (most recent spray 8-21d old)`);
  await sql`UPDATE mosquito_service_status SET pending_reservice = FALSE WHERE pending_reservice = TRUE`;
  const t0 = Date.now();
  let found = 0, done = 0;
  const fails = await pooled(rows.map(r => String(r.id)), async (id) => {
    const html = await getSessionedHtml(`/customer/${id}/scheduled-services`);
    const p = hasPendingReservice(parseScheduledServices(html), today);
    if (p) { found++; console.log(`  pending: ${id}`); }
    await sql`UPDATE mosquito_service_status SET pending_reservice = ${p}, pending_checked_at = NOW() WHERE pocomos_id = ${id}`;
    done++;
  }, 5);
  const ms = Date.now() - t0;
  console.log(`scraped ${done}/${rows.length}, failures ${fails.length}, pending found ${found}`);
  console.log(`elapsed ${(ms/1000).toFixed(1)}s (${(ms/Math.max(done,1)).toFixed(0)}ms per customer)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
