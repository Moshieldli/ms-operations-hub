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
 * THE BOARD WEEK IS THE LAST FULLY-ENDED **SUN–FRI** WEEK, never the in-progress one.
 * The crew's week runs Sunday through Friday (they sometimes spray Sunday, never
 * Saturday), so the bucket is Sun–Sat with a structurally empty Saturday and the
 * board **rolls over on Saturday** — see `boardWeekStart` (rev 36).
 * Probed 2026-07-19: the current week had 609 sprays and **0** resprays, because a
 * respray is bucketed to the week of the spray it is blamed on and re-services
 * arrive days later. Running the awards on the live week makes Iron Wall,
 * Most Improved and Perfect Week meaningless (everybody at 0.0%). The last full
 * week (463 sprays / 10 resprays) is mature and has real spread.
 *
 * SCREEN RULES (product, not incidental):
 *  - Cesar Barrerra is the head tech and is EXCLUDED FROM AWARDS ONLY (rev 38 —
 *    sporadic schedule, not comparable). His sprays and resprays COUNT in the
 *    YTD ticker, the team rate, the weekly table and everything on
 *    /service/resprays. Same for the Z-* route placeholders, whose jobs are real
 *    completed sprays (probed: Z-ASAP 01 = 1 Regular inside a normal cadence
 *    sequence; Z-RLW 01 = 1 genuine re-service 2 days after a Regular).
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
  isMatured,
  maturedWeekStart,
  MATURITY_DAYS,
  RESPRAY_WINDOW_DAYS,
  weekStart,
  type RespJob,
} from "./resprays";
import { isMosquitoServiceType } from "./mosquito";
import { boostExpiry, getActiveReferrals } from "./referrals";

/** Minimum sprays in the board week to qualify for a quality (rate-based) award. */
export const MIN_SPRAYS_FOR_QUALITY_AWARD = 20;
/** Floors that keep a winning stat impressive — see `computeCandidates`. */
export const MIN_CLEAN_STREAK = 20;
export const MIN_ROUTES = 3;

/**
 * Never given an AWARD (rev 38) — but never removed from a number. Cesar is the
 * head tech (ops decision — he covers odd jobs and rescues, so his mix isn't
 * comparable); the rest are Pocomos route placeholders, not people. Their jobs
 * are real work and count everywhere numeric.
 */
export const EXCLUDED_TECHS = new Set(
  ["Cesar Barrerra", "Z-ASAP 01", "Z-RLW 01", "(unassigned)"].map((n) => n.toLowerCase())
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
  /**
   * NO EMOJI FIELD (rev 35). The TV icon is an inline SVG chosen from `id` in
   * `components/tv-icons.tsx` — Yodeck's Linux browser has no color-emoji font
   * and rendered the old glyphs as empty boxes. Keeping an emoji here would
   * invite it straight back onto the screen.
   */
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
/**
 * The referral trophy (rev 41). NOT in `AWARDS`: the six weekly awards are a
 * one-winner-each matching problem, while referrals are per-EVENT — two techs
 * can each hold one, and one tech could hold two. So trophies are built
 * separately in `getTechBoard` and prepended to `winners`; the views already
 * split `topBilling` into the hero slot, and `spin` drives the animation. Both
 * hooks were reserved at rev 28 for exactly this.
 */
export const REFERRAL_AWARD: AwardDef = {
  id: "referral",
  label: "Customer Referral!",
  blurb: "Brought us a new customer",
  topBilling: true,
  spin: true,
};

export const AWARDS: AwardDef[] = [
  { id: "clean-streak", label: "Clean Streak", blurb: "Sprays in a row with no respray" },
  { id: "iron-wall", label: "Iron Wall", blurb: `Respray rate, min ${MIN_SPRAYS_FOR_QUALITY_AWARD} sprays` },
  { id: "workhorse", label: "Workhorse", blurb: "Properties serviced this week" },
  { id: "road-warrior", label: "Road Warrior", blurb: "Distinct routes covered" },
  { id: "most-improved", label: "Most Improved", blurb: "Respray rate, week over week" },
  { id: "perfect-week", label: "Perfect Week", blurb: `Zero resprays on ${MIN_SPRAYS_FOR_QUALITY_AWARD}+ sprays` },
];

// ------------------------------------------------------------------ shapes

/**
 * One tech's numbers, across BOTH clocks (rev 38).
 *
 * VOLUME fields describe the last completed Sun-Fri week — final at Friday
 * close. MATURED fields describe the most recent week whose sprays have all
 * passed the 9-day respray window, so those rates are exact and never revised.
 * The two are usually different weeks; each award prints its own range.
 */
export interface TechWeekStat {
  technician: string;
  /** VOLUME clock: sprays in the last completed week. */
  sprays: number;
  /** VOLUME clock: distinct routes touched in the last completed week. */
  routes: number;
  /** MATURED clock: sprays in the fully-proven week. */
  maturedSprays: number;
  /** MATURED clock: resprays blamed on those sprays. */
  maturedResprays: number;
  /** MATURED clock: maturedResprays / maturedSprays, percent. */
  maturedRate: number;
  /** MATURED clock: rate the week before (null = too few sprays to qualify). */
  priorMaturedRate: number | null;
  /** Season-to-date streak of PROVEN-clean sprays (immature sprays excluded). */
  cleanStreak: number;
}

export interface AwardWinner {
  award: AwardDef;
  technician: string;
  /**
   * The tech is inside a referral BOOST month (rev 41) — every tile he wins
   * carries the badge, not just the trophy, so the celebration lasts the month.
   */
  boosted?: boolean;
  /** Referral trophies only: the customer he referred. NEVER a dollar amount. */
  referredCustomer?: string;
  /** The headline number, pre-formatted (e.g. "0.0%", "101", "16 routes"). */
  stat: string;
  /**
   * WHAT this award measures and OVER WHAT PERIOD, with real dates (rev 38).
   * Required because the two clocks mean adjacent tiles legitimately describe
   * DIFFERENT weeks — without the period a viewer would assume one week and
   * read the board wrong.
   */
  period: string;
  /** Abbreviated period for the narrow board, where the full line won't fit. */
  periodShort: string;
}

/** A live referral trophy — one per referral inside its celebration month. */
export interface ReferralTrophy {
  technician: string;
  customerName: string;
  weekEnding: string;
}

export interface TechBoard {
  /** ISO SUNDAY of the board week (the last fully-ended Sun-Fri week). */
  weekStart: string;
  /** ISO FRIDAY of the board week — the crew's last working day (never Saturday). */
  weekEnd: string;
  /** MATURED clock: Sunday of the most recent fully-proven week. */
  maturedWeekStart: string;
  /** MATURED clock: Friday of that week. */
  maturedWeekEnd: string;
  /** Days within which a re-service counts as a respray (for the footer line). */
  resprayWindowDays: number;
  /** Days a spray must age before it is proven clean. */
  maturityDays: number;
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
  /** Techs inside a referral boost month — their tiles get the badge. */
  boostedTechs: string[];
  /** True when the cache is empty — the view shows a friendly placeholder. */
  stale?: boolean;
}

// ------------------------------------------------------------------ helpers

const isApplication = (j: RespJob) =>
  APPLICATION_JOB_TYPES.has(j.jobType.trim().toLowerCase()) && isMosquitoServiceType(j.serviceType);

/** ISO Sunday `n` weeks before `sundayIso`. */
function shiftWeek(sundayIso: string, weeksBack: number): string {
  const d = new Date(`${sundayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return d.toISOString().slice(0, 10);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The board week = the most recent **Sun–Fri** week that has FULLY ENDED
 * (rev 36). See the file header for why the in-progress week is never used.
 *
 * THE ROLLOVER RULE: **the board flips on SATURDAY.** The crew's last working
 * day is Friday, so the moment Saturday starts, the week that just ran is
 * complete and becomes the board week — it then holds until the next Saturday.
 *
 *   Fri Jul 17 → board = Jul 5    (Jul 12 week still in progress)
 *   Sat Jul 18 → board = Jul 12   ← flips here, the day after its Friday ended
 *   Sun Jul 19 → board = Jul 12
 *   Fri Jul 24 → board = Jul 12
 *   Sat Jul 25 → board = Jul 19
 *
 * Saturday (not Sunday) is the clean choice: waiting for Sunday would leave
 * Saturday showing a week that ended eight days earlier, for no gain — nothing
 * can land in a Sun–Fri week after its Friday, so there is nothing to wait for.
 */
export function boardWeekStart(todayIso: string): string {
  const cur = weekStart(todayIso); // Sunday of the week containing today
  const isSaturday = new Date(`${todayIso}T00:00:00Z`).getUTCDay() === 6;
  // On Saturday the current bucket's work week (Sun–Fri) is already over.
  return isSaturday ? cur : shiftWeek(cur, 1);
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
  volumeWeek: string,
  maturedWeek: string,
  routeByCustomer: Map<string, string>,
  todayIso: string,
  /** Customers with a re-service ON THE BOOKS but not yet performed (rev 39). */
  pendingReservice: Set<string> = new Set()
): TechWeekStat[] {
  const priorMatured = shiftWeek(maturedWeek, 1);
  const counted = attribute(jobs).filter((a) => a.kind === "counted" && a.prior);
  // A spray is "blamed" if it is the prior job of a counted respray — that's what
  // breaks a clean streak, and what a week's respray count is keyed to. Anomaly
  // re-services (outside the 9-day window) blame nobody, so they never appear here.
  const blamedInvoices = new Set(counted.map((a) => a.prior!.invoiceNo));

  // NO tech exclusion here (rev 38). Cesar and the Z-* placeholders must count in
  // every number; they are filtered out only when AWARDS are handed out.
  const apps = jobs.filter(isApplication);

  /**
   * PROVEN CLEAN (rev 39) needs all three: aged past MATURITY_DAYS, not blamed
   * for a completed respray, and no re-service sitting on the books for that
   * customer. The third clause is the one that isn't computable from job history
   * — a booking made on day 9 can be performed on day 15, so "10 days quiet"
   * alone would credit a streak that is already broken.
   */
  const isProven = (j: RespJob) =>
    isMatured(j.completedDate, todayIso) && !pendingReservice.has(j.customerId);

  const byTech = new Map<string, RespJob[]>();
  for (const a of apps) byTech.set(a.technician, [...(byTech.get(a.technician) || []), a]);

  const stats: TechWeekStat[] = [];
  for (const [technician, list] of byTech) {
    const inWeek = list.filter((j) => weekStart(j.completedDate) === volumeWeek);
    // Only PROVEN sprays count toward a matured-week rate — a spray awaiting a
    // booked re-service has no verdict yet and would understate the rate.
    const inMatured = list.filter((j) => weekStart(j.completedDate) === maturedWeek && isProven(j));
    // On the board if he worked EITHER clock's week — the volume week drives the
    // table, the matured week drives the rate awards, and they differ.
    if (inWeek.length === 0 && inMatured.length === 0) continue;

    const routes = new Set(
      inWeek.map((j) => (routeByCustomer.get(j.customerId) || "").trim()).filter(Boolean)
    ).size;

    const maturedResprays = inMatured.filter((j) => blamedInvoices.has(j.invoiceNo)).length;
    const maturedRate = inMatured.length ? (maturedResprays / inMatured.length) * 100 : 0;

    const inPrior = list.filter((j) => weekStart(j.completedDate) === priorMatured && isProven(j));
    const priorResprays = inPrior.filter((j) => blamedInvoices.has(j.invoiceNo)).length;
    const priorMaturedRate =
      inPrior.length >= MIN_SPRAYS_FOR_QUALITY_AWARD ? (priorResprays / inPrior.length) * 100 : null;

    // Clean streak: walk his PROVEN sprays newest-first, counting until one was
    // blamed. Only sprays whose 9-day respray window has closed are proven —
    // an immature spray has no verdict yet, and counting it would inflate the
    // streak of whoever sprayed most recently, then silently revise it later.
    const chrono = [...list]
      .filter(isProven)
      .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
    let cleanStreak = 0;
    for (let i = chrono.length - 1; i >= 0; i--) {
      if (blamedInvoices.has(chrono[i].invoiceNo)) break;
      cleanStreak++;
    }

    stats.push({
      technician,
      sprays: inWeek.length,
      routes,
      maturedSprays: inMatured.length,
      maturedResprays,
      maturedRate,
      priorMaturedRate,
      cleanStreak,
    });
  }
  return stats.sort((a, b) => b.sprays - a.sprays || a.technician.localeCompare(b.technician));
}

/** "2026-08-10" → "Aug 10". */
export function prettyMonthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-07-12","2026-07-17" → "Jul 12–17"; crosses months → "Jul 28–Aug 2". */
export function fmtRange(startIso: string, endIso: string): string {
  const m = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const d = (iso: string) => String(Number(iso.slice(8, 10)));
  return m(startIso) === m(endIso)
    ? `${m(startIso)} ${d(startIso)}–${d(endIso)}`
    : `${m(startIso)} ${d(startIso)}–${m(endIso)} ${d(endIso)}`;
}

/**
 * The sub-line for each award: what it measures, over which dates.
 *
 * VOLUME awards (Workhorse, Road Warrior) cite the last completed week.
 * RATE awards (Iron Wall, Perfect Week, Most Improved) cite the matured week —
 * usually an earlier one. Clean Streak is season-to-date over proven sprays.
 */
function awardPeriod(
  awardId: string,
  volume: { start: string; end: string },
  matured: { start: string; end: string }
): { period: string; periodShort: string } {
  const v = fmtRange(volume.start, volume.end);
  const mt = fmtRange(matured.start, matured.end);
  switch (awardId) {
    case "clean-streak":
      return {
        period: "consecutive proven-clean sprays — season to date",
        periodShort: "season to date",
      };
    case "iron-wall":
      return {
        period: `lowest respray rate (week of ${mt}, min ${MIN_SPRAYS_FOR_QUALITY_AWARD} sprays)`,
        periodShort: `wk ${mt} · rate`,
      };
    case "workhorse":
      return { period: `most properties sprayed (week of ${v})`, periodShort: `wk ${v}` };
    case "road-warrior":
      return { period: `most routes covered (week of ${v})`, periodShort: `wk ${v}` };
    case "most-improved":
      return {
        period: `respray rate vs prior matured week (week of ${mt})`,
        periodShort: `wk ${mt} vs prior`,
      };
    case "perfect-week":
      return { period: `zero resprays (week of ${mt})`, periodShort: `wk ${mt}` };
    default:
      return { period: "", periodShort: "" };
  }
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
  // Volume-clock qualification (Workhorse) vs matured-clock qualification
  // (every rate award) — a tech can clear one and not the other.
  const volumeQualified = stats.filter((s) => s.sprays >= MIN_SPRAYS_FOR_QUALITY_AWARD);
  const maturedQualified = stats.filter((s) => s.maturedSprays >= MIN_SPRAYS_FOR_QUALITY_AWARD);
  const mSprays = stats.reduce((n, s) => n + s.maturedSprays, 0);
  const mResprays = stats.reduce((n, s) => n + s.maturedResprays, 0);
  const teamMaturedRate = mSprays ? (mResprays / mSprays) * 100 : 0;
  switch (awardId) {
    case "clean-streak":
      return [...stats]
        .filter((s) => s.cleanStreak >= MIN_CLEAN_STREAK)
        .sort((a, b) => b.cleanStreak - a.cleanStreak)
        .map((s) => ({ technician: s.technician, stat: `${s.cleanStreak} in a row` }));
    case "iron-wall":
      // Floored at the team's own matured rate — an "Iron Wall" must actually be
      // better than average, even when the matching seats a non-top candidate.
      return [...maturedQualified]
        .filter((s) => s.maturedRate <= teamMaturedRate)
        .sort((a, b) => a.maturedRate - b.maturedRate || b.maturedSprays - a.maturedSprays)
        .map((s) => ({ technician: s.technician, stat: `${s.maturedRate.toFixed(1)}% respray rate` }));
    case "workhorse":
      return [...volumeQualified]
        .sort((a, b) => b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.sprays} properties` }));
    case "road-warrior":
      return [...stats]
        .filter((s) => s.routes >= MIN_ROUTES)
        .sort((a, b) => b.routes - a.routes || b.sprays - a.sprays)
        .map((s) => ({ technician: s.technician, stat: `${s.routes} routes` }));
    case "most-improved":
      // Only a genuine improvement (rate went DOWN) is ever shown — never a regression.
      return [...maturedQualified]
        .filter((s) => s.priorMaturedRate !== null && s.priorMaturedRate > s.maturedRate)
        .sort(
          (a, b) =>
            b.priorMaturedRate! - b.maturedRate - (a.priorMaturedRate! - a.maturedRate)
        )
        .map((s) => ({
          technician: s.technician,
          stat: `${s.priorMaturedRate!.toFixed(1)}% → ${s.maturedRate.toFixed(1)}%`,
        }));
    case "perfect-week":
      return [...maturedQualified]
        .filter((s) => s.maturedResprays === 0)
        .sort((a, b) => b.maturedSprays - a.maturedSprays)
        .map((s) => ({
          technician: s.technician,
          stat: `${s.maturedSprays} sprays, 0 resprays`,
        }));
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
/** Periods are attached by the caller, which knows both clocks' dates. */
export type AwardSeat = Omit<AwardWinner, "period" | "periodShort">;

export function assignAwards(
  stats: TechWeekStat[],
  lastWeekByAward: Map<string, string>
): AwardSeat[] {
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
async function recordAwards(weekStartIso: string, winners: AwardSeat[]): Promise<void> {
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

  const matured = maturedWeekStart(today);
  const pendingRows = (await sql`
    SELECT pocomos_id FROM mosquito_service_status WHERE pending_reservice = TRUE
  `) as Array<{ pocomos_id: string }>;
  const pendingReservice = new Set(pendingRows.map((r) => String(r.pocomos_id)));
  const stats = buildWeekStats(jobs, board, matured, routeByCustomer, today, pendingReservice);
  const lastWeek = await readLastWeekAwards(shiftWeek(board, 1));
  // EXCLUSION IS AWARDS-ONLY (rev 38). Cesar (head tech, sporadic schedule) and
  // the Z-* route placeholders never win an award, but their sprays and
  // resprays count in every number on this page and on /service/resprays.
  const awardStats = stats.filter((s) => !isExcludedTech(s.technician));
  const rawWinners = assignAwards(awardStats, lastWeek);

  // ---- Referral trophies + the boost month (rev 41) ----
  // Trophies are per-EVENT, so they're built here rather than going through the
  // one-winner-per-award matching. A tech excluded from awards (Cesar, the Z-*
  // placeholders) still can't take the hero slot.
  const activeReferrals = await getActiveReferrals(today);
  const boosted = new Set(activeReferrals.map((r) => r.technician));
  const trophies: AwardWinner[] = activeReferrals
    .filter((r) => !isExcludedTech(r.technician))
    .map((r) => ({
      award: REFERRAL_AWARD,
      technician: r.technician,
      // NO dollar amount, anywhere — the customer's name IS the headline.
      stat: r.customerName,
      referredCustomer: r.customerName,
      boosted: true,
      period: `referred a new customer · celebrating through ${prettyMonthDay(
        boostExpiry(r.weekEnding)
      )}`,
      periodShort: `thru ${prettyMonthDay(boostExpiry(r.weekEnding))}`,
    }));

  const winners: AwardWinner[] = [
    ...trophies,
    ...rawWinners.map((w) => ({
      ...w,
      boosted: boosted.has(w.technician),
      ...awardPeriod(
        w.award.id,
        { start: board, end: addDays(board, 5) },
        { start: matured, end: addDays(matured, 5) }
      ),
    })),
  ];
  // Record only the six weekly award SEATS for repeat-avoidance. Referral
  // trophies are per-event (two can share award_id="referral" in one week, which
  // would collide on the (week_start, award_id) key) and aren't a weekly award —
  // never record them here.
  if (rawWinners.length > 0) await recordAwards(board, rawWinners);

  // YTD ticker — WHOLE TEAM, including Cesar and the Z-* placeholders.
  const ytdApps = jobs.filter(isApplication);
  const ytdResprays = attribute(jobs).filter((a) => a.kind === "counted" && a.tech).length;
  /**
   * TEAM-BEST streak (rev 40) — the true maximum across EVERY tech, Cesar and
   * the placeholders included, because this is a numeric season stat and not an
   * award (exclusion is awards-only).
   *
   * ⚠️ It deliberately may NOT equal the Clean Streak tile's winner. The award
   * matching can seat a credible non-top candidate so that every tech leaves
   * with something, so the tile showed 108 while the real best was 109 — two
   * lines on one screen that looked like a contradiction. The fix is the LABEL,
   * not the number: the ticker says "Team best" (a leaderboard fact) and the
   * tile carries an award name. Echoing the tile instead would have printed
   * "longest streak 108" while a 109 existed — trading an ambiguity for a
   * falsehood.
   */
  const best = [...stats].sort((a, b) => b.cleanStreak - a.cleanStreak)[0];

  return {
    boostedTechs: [...boosted],
    weekStart: board,
    // FRIDAY, not Saturday: the bucket is Sun–Sat but the crew never works
    // Saturday, so showing "Jul 12 – Jul 18" would advertise a day nobody
    // sprayed. The bucket still spans 7 days so nothing can fall through.
    weekEnd: addDays(board, 5),
    maturedWeekStart: matured,
    maturedWeekEnd: addDays(matured, 5),
    resprayWindowDays: RESPRAY_WINDOW_DAYS,
    maturityDays: MATURITY_DAYS,
    year: CURRENT_YEAR,
    asOf: new Date().toISOString(),
    winners,
    // Table keeps EVERY tech who worked the VOLUME week — Cesar and the Z-*
    // placeholders included; it is a numbers table, not an award. Techs with 0
    // volume-week sprays are dropped rather than printed as "0 sprays, 0.0%",
    // which reads as a bad week rather than "wasn't on the schedule".
    // `sprays` = volume week, `rate` = matured week (see the two clocks).
    table: stats
      .filter((s) => s.sprays > 0)
      .map((s) => ({ technician: s.technician, sprays: s.sprays, rate: s.maturedRate })),
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
