/**
 * Fill the leads_followup cache from the local machine (same code the cron runs).
 * READ-ONLY against Pocomos.
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/run-leads-followup.ts
 */
import { refreshLeadsFollowup, getFollowupReport } from "../src/lib/leads/followup";
(async () => {
  const meta = await refreshLeadsFollowup();
  console.log(`scope ${meta.scope} leads · boards ${meta.boardsScraped} · task details ${meta.taskDetailsScraped} · failed ${meta.failed} · ${(meta.durationMs/1000).toFixed(1)}s`);
  console.log(`counts: overdue ${meta.counts.overdue} · no-task ${meta.counts.noTask} · no-open-task ${meta.counts.noOpenTask} · on-track ${meta.counts.onTrack} · with PB activity ${meta.counts.withPbActivity}`);
  const r = await getFollowupReport();
  const sum = r.counts.overdue + r.counts.noTask + r.counts.noOpenTask + r.counts.onTrack;
  console.log(`\ncache rows ${r.leads.length} · buckets sum ${sum} (${sum === r.leads.length ? "PASS" : "FAIL"})`);
  console.log(`\ntop 8 by days overdue:`);
  for (const l of r.leads.slice(0, 8))
    console.log(`  ${String(l.daysOverdue ?? "-").padStart(3)}d  ${l.name.padEnd(22).slice(0,22)} ${l.leadId} created ${l.createdDate} · ${l.salesperson ?? "?"} · touches ${l.touches} · last ${l.lastTouchAt?.slice(0,10) ?? "-"} · due ${l.taskDueAt?.slice(0,10) ?? "-"} · pb ${l.pbCalls}`);
  console.log(`\nno-task sample:`);
  for (const l of r.leads.filter((x) => x.bucket === "no_task").slice(0, 5))
    console.log(`   ${l.name.padEnd(22).slice(0,22)} ${l.leadId} created ${l.createdDate} · ${l.salesperson ?? "?"} · pb ${l.pbCalls}`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
