/**
 * PROBE (READ-ONLY, Part 4 rev 62): current Sun–Fri service week vs the
 * CALENDAR sheet + Pocomos stop counts + current announcements.
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/probe-board-week.ts
 */
import { getMasterRoutingSchedule } from "../src/lib/service/masterRouting";
import { weekStart } from "../src/lib/service/resprays";
import { normalizeDaycode } from "../src/lib/service/routeTowns";
import { sql } from "../src/lib/db";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  let ws = weekStart(eastern);
  const dow = new Date(`${eastern}T00:00:00Z`).getUTCDay();
  if (dow === 6) ws = addDays(ws, 7); // Saturday → flip to next week
  const days = [0, 1, 2, 3, 4, 5].map((n) => addDays(ws, n)); // Sun..Fri
  console.log(`today(E)=${eastern} weekStart=${ws} days=${days.join(",")}`);

  const sheet = await getMasterRoutingSchedule(days);
  console.log(`sheet: ${sheet ? `${sheet.size} days matched` : "NULL (no creds/read fail)"}`);
  if (sheet) {
    for (const d of days) {
      const sd = sheet.get(d);
      if (!sd) {
        console.log(`  ${d}: (no sheet data)`);
        continue;
      }
      console.log(`  ${d}: note=${JSON.stringify(sd.note)}`);
      for (const r of sd.rows) {
        console.log(
          `    ${r.tech} | code=${JSON.stringify(r.daycode)} | van=${r.van} | towns=${JSON.stringify(r.towns)} | stops=${r.stops}`
        );
      }
    }
  }

  // Pocomos per-(day, route) counts for the week — the "stop counts look wrong" check.
  const rows = (await sql`
    SELECT next_service_date::text AS d, route_code, COUNT(*)::int AS n
    FROM mosquito_service_status
    WHERE next_service_date >= ${days[0]}::date AND next_service_date <= ${days[5]}::date
    GROUP BY 1, 2 ORDER BY 1, 3 DESC
  `) as Array<{ d: string; route_code: string | null; n: number }>;
  console.log(`\nPocomos stops by (day, route_code) — ${rows.length} groups:`);
  const byDay = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.d;
    const norm = normalizeDaycode(r.route_code || "");
    byDay.set(key, [...(byDay.get(key) ?? []), `${r.route_code ?? "NULL"}(→${norm || "?"})=${r.n}`]);
  }
  for (const [d, list] of byDay) console.log(`  ${d}: ${list.join("  ")}`);

  const ann = (await sql`SELECT this_week, next_week FROM board_announcements WHERE id = 1`) as Array<{
    this_week: string;
    next_week: string;
  }>;
  console.log(`\nannouncements: ${JSON.stringify(ann[0] ?? null)}`);
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'board_announcements'
  `) as Array<{ column_name: string }>;
  console.log(`board_announcements columns: ${cols.map((c) => c.column_name).join(", ")}`);
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
