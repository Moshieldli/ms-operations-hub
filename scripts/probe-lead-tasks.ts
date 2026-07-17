/** PROBE 2 (READ-ONLY): how do TASKS + COMMENTS load on /lead/{id}/message-board? */
import { getSessionedHtml } from "../src/lib/pocomos/webSession";

const LEADS = ["5986388"]; // a live 2026 open lead

(async () => {
  for (const id of LEADS) {
    const html = await getSessionedHtml(`/lead/${id}/message-board`);
    console.log(`\n=== /lead/${id}/message-board — ${html.length} bytes ===`);

    // Tables present?
    const tables = [...html.matchAll(/<table[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    console.log(`table ids: ${tables.join(", ") || "(none)"}`);

    // Any DataTables ajax feeds?
    const urls = new Set<string>();
    for (const m of html.matchAll(/["'](\/[^"']*(?:task|comment|message)[^"']*)["']/gi)) urls.add(m[1]);
    console.log(`\nurls mentioning task/comment/message:`);
    for (const u of [...urls].slice(0, 20)) console.log(`   ${u}`);

    // Is the tasks table server-rendered? Dump its headers + first rows.
    for (const tid of tables) {
      const i = html.indexOf(`id="${tid}"`);
      const seg = html.slice(i, i + 4000).replace(/<script[\s\S]*?<\/script>/g, "");
      const ths = [...seg.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
      const trs = (seg.match(/<tr[\s\S]*?<\/tr>/g) || []).slice(1, 3)
        .map((t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      console.log(`\n--- table #${tid} ---`);
      console.log(`   headers: ${ths.join(" | ") || "(none)"}`);
      for (const r of trs) console.log(`   row: ${r.slice(0, 200)}`);
    }

    // Comment markers
    for (const kw of ["comment", "Comment", "due", "Due", "task", "Task"]) {
      const n = (html.match(new RegExp(kw, "g")) || []).length;
      console.log(`   '${kw}' occurrences: ${n}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
