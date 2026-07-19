import { refreshLeadsFollowup, getFollowupReport } from "../src/lib/leads/followup";
(async () => {
  console.log("running followup refresh (board + notes per lead)...");
  const m = await refreshLeadsFollowup();
  console.log(`done in ${(m.durationMs/1000).toFixed(0)}s · scope ${m.scope} · boards ${m.boardsScraped} · notes ${m.notesScraped} · failed ${m.failed}`);
  const r = await getFollowupReport();
  const c = r.counts;
  console.log(`\nBUCKETS: never_reached ${c.neverReached} · loop_not_closed ${c.loopNotClosed} · working_overdue ${c.workingOverdue} · working_on_track ${c.workingOnTrack}`);
  const sum = c.neverReached+c.loopNotClosed+c.workingOverdue+c.workingOnTrack;
  console.log(`sum ${sum} === scope ${c.scope} : ${sum===c.scope?"PASS":"FAIL"}`);
  console.log(`withPbActivity (never+loop): ${c.withPbActivity}`);
  console.log(`\nnever_reached sample:`);
  for (const l of r.leads.filter(x=>x.bucket==="never_reached").slice(0,5)) console.log(`  ${l.name} (${l.leadId}) created ${l.createdDate} · notes ${l.notesCount} · openTasks ${l.openTaskCount} archived ${l.archivedTaskCount}`);
  console.log(`\nloop_not_closed sample:`);
  for (const l of r.leads.filter(x=>x.bucket==="loop_not_closed").slice(0,5)) console.log(`  ${l.name} (${l.leadId}) · notes ${l.notesCount} lastNote ${l.lastNoteAt} · archived ${l.archivedTaskCount}`);
  console.log(`\nworking_overdue sample:`);
  for (const l of r.leads.filter(x=>x.bucket==="working_overdue").slice(0,5)) console.log(`  ${l.name} (${l.leadId}) · due ${l.taskDueAt?.slice(0,10)} · daysOverdue ${l.daysOverdue}`);
  process.exit(0);
})().catch(e=>{console.error("FAILED:",e);process.exit(1);});
