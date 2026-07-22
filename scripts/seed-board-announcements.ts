/**
 * Seed board_announcements from the PHYSICAL weekly board (rev 62). Only fills
 * fields that are currently EMPTY — never clobbers an ops edit. Idempotent.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/seed-board-announcements.ts
 */
import { initSchema, sql } from "../src/lib/db";

const THIS_WEEK = "THIS WEEK: All weekly synthetic services will be NATURAL";
const NEXT_WEEK = "NEXT WEEK: All weekly natural services will be SYNTHETIC";

(async () => {
  await initSchema();
  const rows = (await sql`
    SELECT this_week, next_week, urgent FROM board_announcements WHERE id = 1
  `) as Array<{ this_week: string; next_week: string; urgent: string }>;
  const cur = rows[0] ?? { this_week: "", next_week: "", urgent: "" };
  const thisWeek = cur.this_week.trim() || THIS_WEEK;
  const nextWeek = cur.next_week.trim() || NEXT_WEEK;
  await sql`
    INSERT INTO board_announcements (id, this_week, next_week, urgent, updated_at)
    VALUES (1, ${thisWeek}, ${nextWeek}, ${cur.urgent ?? ""}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      this_week = EXCLUDED.this_week, next_week = EXCLUDED.next_week, updated_at = NOW()
  `;
  console.log(`seeded: this_week=${JSON.stringify(thisWeek)} next_week=${JSON.stringify(nextWeek)}`);
})().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
