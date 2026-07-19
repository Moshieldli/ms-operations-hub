/**
 * /tv/techs — "Tech Board" (rev 28). A Yodeck-ready, auto-refreshing weekly
 * recognition screen for the shop TV.
 *
 * SOURCE: no new scrape. Everything is computed on read from caches two existing
 * nightly crons already fill:
 *   - `respray_jobs`            (cron `/api/cron/resprays`, 08:00) — every mosquito
 *                                job YTD: technician, job type, customer, date.
 *   - `mosquito_service_status` (cron `/api/cron/mosquito-status`, 06:00) — carries
 *                                `route_code` per customer, joined on
 *                                `pocomos_id = respray_jobs.customer_id`.
 *     Probed 2026-07-19: 617/619 of the week's jobs join to a route (99.7%),
 *     44 distinct routes. The id spaces match — NO short/web id conversion needed.
 *
 * THE BOARD WEEK IS THE LAST **COMPLETED** MON–SUN WEEK, never the in-progress one.
 * Probed 2026-07-19: the current week had 609 sprays and **0** resprays, because a
 * respray is bucketed to the week of the spray it is blamed on and re-services
 * arrive days later. Running the awards on the live week makes Iron Wall,
 * Most Improved and Perfect Week meaningless (everybody at 0.0%). The last full
 * week (463 sprays / 10 resprays) is mature and has real spread.
 *
 * SCREEN RULES (product, not incidental):
 *  - Cesar Barrerra is the head tech and is EXCLUDED from every award and table.
 *  - NO negative callouts, ever. This screen never ranks anybody last.
 *  - Route-fair: volume never judges performance. Sprays-per-week is its own
 *    positive award (Workhorse) and is NOT mixed into any quality award.
 *  - Every tech who worked the board week gets AT LEAST ONE award (see
 *    `assignAwards`), and we avoid handing a tech the same award two weeks
 *    running when another credible candidate exists.
 */
import { initSchema, sql } from "@/lib/db";
import { CURRENT_YEAR } from "@/lib/pocomos";
import {
  APPLICATION_JOB_TYPES,
  attribute,
  weekStart,
  type RespJob,
} from "./resprays";
import { isMosquitoServiceType } from "./mosquito";

/** Minimum sprays in the board week to qualify for a quality (rate-based) award. */
export const MIN_SPRAYS_FOR_QUALITY_AWARD = 20;
/** Floors that keep a winning stat impressive — see `computeCandidates`. */
export const MIN_CLEAN_STREAK = 20;
export const MIN_ROUTES = 3;

/**
 * Never shown on the board. Cesar is the head tech (ops decision — he covers
 * odd jobs and rescues, so his mix isn't comparable). The rest are Pocomos
 * placeholders, not people.
 */
export const EXCLUDED_TECHS = new Set(
  ["Cesar Barrerra", "Z-ASAP 01", "(unassigned)"].map((n) => n.toLowerCase())
);

export const isExcludedTech = (name: string) => EXCLUDED_TECHS.has(name.trim().toLowerCase());

// ------------------------------------------------------------------ award config

/**
 * An award definition. Adding an award = adding an entry to `AWARDS` and a
 * matching case in `computeCandidates` — nothing in the view changes.
 *
 * `topBilling` reserves the hero slot at the top of the grid and is what the
 * DEFERRED referral trophy (BACKLOG: TV-TECHS-REFERRAL) will set once a data
 * source exists; `spin` turns on the trophy spin animation for it. No award
 * sets either today, and the view already handles both.
 */
export interface AwardDef {
  id: string;
  emoji: string;
  label: string;
  /** One short line under the winner — what the award means. Always positive. */
  blurb: string;
  /** Renders in the full-width hero slot above the grid. */
  topBilling?: boolean;
  /** Adds the spinning-trophy animation (for a future top-billing trophy). */
  spin?: boolean;
}

/**
 * Blurbs are DESCRIPTIVE, never superlative ("Sprays in a row with no respray",
 * not "Most sprays in a row"). The matching in `assignAwards` can seat a
 * credible non-top candidate, so a "Most …" blurb would be a falsifiable claim
 * printed on the wall next to a number that contradicts it. The award NAME
 * carries the honour; the blurb just says what's being measured.
 */
export const AWARDS: AwardDef[] = [
  { id: "clean-streak", emoji: "🎯", label: "Clean Streak", blurb: "Sprays in a row with no respray" },
  { id: "iron-wall", emoji: "🛡️", label: "Iron Wall", blurb: `Respray rate, min ${MIN_SPRAYS_FOR_QUALITY_AWARD} sprays` },
  { id: "workhorse", emoji: "⚡", label: "Workhorse", blurb: "Properties serviced this week" },
  { id: "road-warrior", emoji: "🗺️", label: "Road Warrior", blurb: "Distinct routes covered" },
  { id: "most-improved", emoji: "📈", label: "Most Improved", blurb: "Respray rate, week over week" },
  { id: "perfect-week", emoji: "🏅", label: "Perfect Week", blurb: `Zero resprays on ${MIN_SPRAYS_FOR_QUALITY_AWARD}+ sprays` },
];

// ------------------------------------------------------------------ shapes

/** One tech's numbers for the board week. */
export interface TechWeekStat {
  technician: string;
  sprays: number;
  resprays: number;
  rate: number;
  /** Distinct route codes touched in the board week. */
  routes: number;
  /** Current running streak of consecutive sprays with no respray (YTD). */
  cleanStreak: number;
  /** Respray rate the week before the board week (null = didn't qualify). */
  priorRate: number | null;
}

export interface AwardWinner {
  award: AwardDef;
  technician: string;
  /** The headline number, pre-formatted (e.g. "0.0%", "101", "16 routes"). */
  stat: string;
}

export interface TechBoard {
  /** ISO Monday of the board week (the last COMPLETED week). */
  weekStart: string;
  /** ISO Sunday of the board week. */
  weekEnd: string;
  year: string;
  asOf: string;
  winners: AwardWinner[];
  /** Bottom table — sprays + rate only. No ranking, no negative framing. */
  table: Array<{ technician: string; sprays: number; rate: number }>;
  ytd: {
    sprays: number;
    resprays: number;
    rate: number;
    longestCleanStreak: number;
    longestCleanStreakTech: string;
  };
  /** True when the cache is empty — the view shows a friendly placeholder. */
  stale?: boolean;
}

// ------------------------------------------------------------------ helpers

const isApplication = (j: RespJob) =>
  APPLICATION_JOB_TYPES.has(j.jobType.trim().toLowerCase()) && isMosquitoServiceType(j.serviceType);

/** ISO Monday `n` weeks before `mondayIso`. */
function shiftWeek(mondayIso: string, weeksBack: number): string {
  const d = new Date(`${mondayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return d.toISOString().slice(0, 10);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The board week = the last COMPLETED Mon–Sun week. See the file header for why
 * the in-progress week is never used.
 */
export function boardWeekStart(todayIso: string): string {
  return shiftWeek(weekStart(todayIso), 1);
}

// ------------------------------------------------------------------ stats

/**
 * Per-tech stats for the board week, plus the YTD clean streak.
 *
 * `routeByCustomer` maps customer id → route code so Road Warrior can count
 * distinct routes; customers with no route code just don't contribute.
 */
export function buildWeekStats(
  jobs: RespJob[],
  board: string,
  routeByCustomer: Map<string, string>
): TechWeekStat[] {
  const prior = shiftWeek(board, 1);
  const boardEnd = addDays(board, 6);
  const counted = attribute(jobs).filter((a) => a.kind === "counted" && a.prior);
  // A spray is "blamed" if it is the prior job of a counted respray — that's what
  // breaks a clean streak, and what the week's respray count is keyed to.
  const blamedInvoices = new Set(counted.map((a) => a.prior!.invoiceNo));

  const apps = jobs.filter(isApplication).filter((j) => !isExcludedTech(j.technician));

  const byTech = new Map<string, RespJob[]>();
  for (const a of apps) byTech.set(a.technician, [...(byTech.get(a.technician) || []), a]);

  const stats: TechWeekStat[] = [];
  for (const [technician, list] of byTech) {
    const inWeek = list.filter((j) => weekStart(j.completedDate) === board);
    if (inWeek.length === 0) continue; // didn't work the board week → not on the board

    const resprays = inWeek.filter((j) => blamedInvoices.has(j.invoiceNo)).length;
    const routes = new Set(
      inWeek.map((j) => (routeByCustomer.get(j.customerId) || "").trim()).filter(Boolean)
    ).size;

    const inPrior = list.filter((j) => weekStart(j.completedDate) === prior);
    const priorResprays = inPrior.filter((j) => blamedInvoices.has(j.invoiceNo)).length;
    const priorRate =
      inPrior.length >= MIN_SPRAYS_FOR_QUALITY_AWARD ? (priorResprays / inPrior.length) * 100 : null;

    // Clean streak: walk his sprays newest-first, counting until one was blamed.
    // Capped at the END OF THE BOARD WEEK — sprays after it belong to the live
    // week, whose resprays haven't arrived yet, so counting them would inflate
    // the streak of whoever sprayed most recently and could hand the award to
    // the tech with the week's WORST rate. Same maturity rule as every other award.
    const chrono = [...list]
      .filter((j) => j.completedDate <= boardEnd)
      .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
    let cleanStreak = 0;
    for (let i = chrono.length - 1; i >= 0; i--) {
      if (blamedInvoices.has(chrono[i].invoiceNo)) break;
      cleanStreak++;
    }

    stats.push({
      technician,
      sprays: inWeek.length,
      resprays,
      rate: (resprays / inWeek.length) * 100,
      routes,
      cleanStreak,
      priorRate,
    });
  }
  return stats.sort((a, b) => b.sprays - a.sprays || a.technician.localeCompare(b.technician));
}

// ------------------------------------------------------------------ awards

/**
 * Ranked CREDIBLE candidates for one award, best first. Empty = no winner.
 *
 * Every list is floored so a winner's stat always reads as an achievement. This
 * matters because the coverage pass may hand an award to a lower-ranked
 * candidate: without a floor, "Clean Streak — 2 in a row" can reach the screen,
 * which is a backhanded compliment, not a callout.
 */
function computeCandidates(awardId: string, stats: TechWeekStat[]): Array<{ technician: string; stat: string }> {
  const qualified = stats.filter((s) => s.sprays >= MIN_SPRAYS_FOR_QUALITY_AWARD);
  const weekSprays = stats.reduce((n, s) => n + s.sprays, 0);
  const weekResprays = stats.reduce((n, s) => n + s.resprays, 0);
  const teamRate = weekSprays ? (weekResprays / weekSprays) * 100 : 0;
  switch (awardId) {
    case "clean-streak":
      return [...stats]
        .filter((s) => s.cleanStreak >= MIN_CLEAN_STREAK)
        .sort((a, b) => b.cleanStreak - a.cleanStreak)
        .map((s) => ({ technician: s.technician, stat: `${s.cleanStreak} in a row` }));
    case "iron-wall":
      // Floored at the team's own week rate — an "Iron Wall" must actually be
      // better than average, even when the matching seats a non-top candidate.
      return [...qualified]
        .filter((s) => s.rate <= teamRate)
        .sort((a, b) => a.rate - b.rate || b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.rate.toFixed(1)}% respray rate` }));
    case "workhorse":
      return [...qualified]
        .sort((a, b) => b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.sprays} properties` }));
    case "road-warrior":
      return [...stats]
        .filter((s) => s.routes >= MIN_ROUTES)
        .sort((a, b) => b.routes - a.routes || b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.routes} routes` }));
    case "most-improved":
      // Only a genuine improvement (rate went DOWN) is ever shown — never a regression.
      return [...qualified]
        .filter((s) => s.priorRate !== null && s.priorRate > s.rate)
        .sort((a, b) => b.priorRate! - b.rate - (a.priorRate! - a.rate))
        .map((s) => ({
          technician: s.technician,
          stat: `${s.priorRate!.toFixed(1)}% → ${s.rate.toFixed(1)}%`,
        }));
    case "perfect-week":
      return [...qualified]
        .filter((s) => s.resprays === 0)
        .sort((a, b) => b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.sprays} sprays, 0 resprays` }));
    default:
      return [];
  }
}

/**
 * Hand out the awards so that EVERY tech who worked the board week leaves with
 * at least one — and every displayed stat is a genuine achievement.
 *
 * This is a maximum-bipartite-matching problem (techs ↔ awards they credibly
 * qualify for), NOT a greedy hand-out. A greedy pass fails badly here: give each
 * award to its top candidate and one strong tech can sweep three, leaving
 * another tech to be "covered" by demoting a real superlative into a weak one
 * (the first cut shipped "Clean Streak — 2 in a row" over a genuine 138-streak).
 * Kuhn's algorithm instead finds an assignment covering the most techs possible,
 * and each tech is tried against his OWN best-ranked awards first.
 *
 * 1. Matching pass — cover as many techs as possible, one award each.
 * 2. Leftover awards go to their top credible candidate (may double up a tech).
 * 3. A tech who repeated last week's award yields it to the next candidate.
 *
 * A tech with no credible candidacy at all simply isn't on the awards grid; he
 * still appears in the neutral bottom table. Inventing a superlative for him
 * would be worse than silence.
 */
export function assignAwards(
  stats: TechWeekStat[],
  lastWeekByAward: Map<string, string>
): AwardWinner[] {
  const candidates = new Map(AWARDS.map((a) => [a.id, computeCandidates(a.id, stats)]));
  const rankOf = (awardId: string, tech: string) =>
    candidates.get(awardId)!.findIndex((c) => c.technician === tech);

  /** award id → tech, the matching being built. */
  const matched = new Map<string, string>();

  // --- 1. Kuhn's augmenting-path matching, each tech tried on his best awards first.
  const tryAssign = (tech: string, seen: Set<string>): boolean => {
    const wanted = AWARDS.map((a) => ({ id: a.id, rank: rankOf(a.id, tech) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank);
    for (const { id } of wanted) {
      if (seen.has(id)) continue;
      seen.add(id);
      const incumbent = matched.get(id);
      // Free award, or the incumbent can be re-homed elsewhere.
      if (!incumbent || tryAssign(incumbent, seen)) {
        matched.set(id, tech);
        return true;
      }
    }
    return false;
  };
  // Techs with the fewest credible candidacies go first — they're the hardest to
  // place, and placing them early is what makes full coverage achievable.
  const byScarcity = [...stats].sort(
    (a, b) =>
      AWARDS.filter((x) => rankOf(x.id, a.technician) >= 0).length -
      AWARDS.filter((x) => rankOf(x.id, b.technician) >= 0).length
  );
  for (const s of byScarcity) tryAssign(s.technician, new Set());

  // --- 2. Awards nobody was matched to go to their top credible candidate.
  for (const a of AWARDS) {
    if (matched.has(a.id)) continue;
    const top = candidates.get(a.id)![0];
    if (top) matched.set(a.id, top.technician);
  }

  // --- 3. Avoid the same tech taking the same award two weeks running.
  for (const a of AWARDS) {
    const tech = matched.get(a.id);
    if (!tech || lastWeekByAward.get(a.id) !== tech) continue;
    const alt = candidates.get(a.id)!.find((c) => c.technician !== tech);
    // Only swap if the alternate still leaves the repeating tech covered elsewhere.
    const coveredElsewhere = [...matched.entries()].some(([id, t]) => id !== a.id && t === tech);
    if (alt && coveredElsewhere) matched.set(a.id, alt.technician);
  }

  return AWARDS.filter((a) => matched.has(a.id)).map((a) => {
    const tech = matched.get(a.id)!;
    const entry = candidates.get(a.id)!.find((c) => c.technician === tech)!;
    return { award: a, technician: tech, stat: entry.stat };
  });
}

// ------------------------------------------------------------------ read

/** Last week's assignment, so we can avoid repeating an award for the same tech. */
async function readLastWeekAwards(weekStartIso: string): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT award_id, technician FROM tv_tech_awards WHERE week_start = ${weekStartIso}::date
  `) as Array<Record<string, string>>;
  return new Map(rows.map((r) => [r.award_id, r.technician]));
}

/** Remember this week's assignment (idempotent) so next week can avoid repeats. */
async function recordAwards(weekStartIso: string, winners: AwardWinner[]): Promise<void> {
  if (winners.length === 0) return;
  await sql`
    INSERT INTO tv_tech_awards (week_start, award_id, technician)
    SELECT ${weekStartIso}::date, * FROM UNNEST(
      ${winners.map((w) => w.award.id)}::text[], ${winners.map((w) => w.technician)}::text[]
    )
    ON CONFLICT (week_start, award_id) DO UPDATE SET technician = EXCLUDED.technician
  `;
}

/**
 * Build the board from the caches — no Pocomos calls, so the TV can hit this
 * every 10 minutes for free.
 */
export async function getTechBoard(): Promise<TechBoard> {
  await initSchema();
  const today = new Date().toISOString().slice(0, 10);
  const board = boardWeekStart(today);

  const rows = (await sql`
    SELECT invoice_no, customer_id, customer_name, technician, job_type, service_type,
           to_char(completed_date, 'YYYY-MM-DD') AS completed_date
    FROM respray_jobs
  `) as Array<Record<string, string>>;
  const jobs: RespJob[] = rows.map((r) => ({
    invoiceNo: r.invoice_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    technician: r.technician,
    jobType: r.job_type,
    serviceType: r.service_type,
    completedDate: r.completed_date,
  }));

  const routeRows = (await sql`
    SELECT pocomos_id, route_code FROM mosquito_service_status
    WHERE route_code IS NOT NULL AND btrim(route_code) <> ''
  `) as Array<Record<string, string>>;
  const routeByCustomer = new Map(routeRows.map((r) => [r.pocomos_id, r.route_code]));

  const stats = buildWeekStats(jobs, board, routeByCustomer);
  const lastWeek = await readLastWeekAwards(shiftWeek(board, 1));
  const winners = assignAwards(stats, lastWeek);
  if (winners.length > 0) await recordAwards(board, winners);

  // YTD ticker — team totals across every non-excluded tech, plus the best streak.
  const ytdApps = jobs.filter(isApplication).filter((j) => !isExcludedTech(j.technician));
  const ytdResprays = attribute(jobs).filter(
    (a) => a.kind === "counted" && a.tech && !isExcludedTech(a.tech)
  ).length;
  const best = [...stats].sort((a, b) => b.cleanStreak - a.cleanStreak)[0];

  return {
    weekStart: board,
    weekEnd: addDays(board, 6),
    year: CURRENT_YEAR,
    asOf: new Date().toISOString(),
    winners,
    table: stats.map((s) => ({ technician: s.technician, sprays: s.sprays, rate: s.rate })),
    ytd: {
      sprays: ytdApps.length,
      resprays: ytdResprays,
      rate: ytdApps.length ? (ytdResprays / ytdApps.length) * 100 : 0,
      longestCleanStreak: best?.cleanStreak ?? 0,
      longestCleanStreakTech: best?.technician ?? "—",
    },
    stale: jobs.length === 0,
  };
}
