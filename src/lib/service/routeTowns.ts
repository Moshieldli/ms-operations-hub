/**
 * DAYCODE → towns/area map (rev 45), the "DAYCODES" reference from the 2026
 * Master Routing List.
 *
 * ⚠️ THIS IS A SNAPSHOT, read from the sheet on 2026-07-20 (probed via Drive).
 * Route geography is stable season-to-season, so a snapshot is a safe v1 — but
 * the LIVE sheet read (`masterRouting.ts`) supersedes it the moment the Google
 * Drive + Sheets APIs are enabled for the service account (same unblock as the
 * referral scanner). Until then the schedule board reads this.
 *
 * `area` is the coarse region the CALENDAR itself uses ("Local", "Westchester",
 * "Great Neck", "Brooklyn", "Queens", "Long Island"); `towns` is the detailed
 * list for the tooltip / wide layout. Pocomos route_code == the daycode here.
 */
export interface RouteDef {
  area: string;
  towns: string[];
}

const R: Record<string, RouteDef> = {
  // ROUTE 1
  "101": { area: "Brooklyn", towns: ["Brooklyn"] },
  "102": { area: "Queens", towns: ["Flushing", "Forest Hills", "Great Neck", "Jamaica", "Kew Gardens", "Queens", "Richmond Hill"] },
  "103": { area: "Far Rockaway", towns: ["Bayswater", "Far Rockaway", "Arverne"] },
  "104": { area: "Westchester", towns: ["Armonk", "Briarcliff Manor", "Chappaqua", "Croton on Hudson", "Dobbs Ferry", "Elmsford", "Hartsdale", "Hawthorne", "Ossining", "Peekskill", "Pleasantville", "Scarsdale", "Sleepy Hollow", "Tarrytown", "Yorktown Heights", "Thornwood", "Yonkers"] },
  "106": { area: "Far Rockaway", towns: ["Atlantic Beach", "Far Rockaway", "Lawrence"] },
  "107": { area: "Long Island", towns: ["Bethpage", "East Norwich", "Hicksville", "Jericho", "Plainview", "Syosset", "Woodbury"] },
  "108": { area: "Queens", towns: ["Flushing", "Jamaica", "Kew Gardens Hills", "Queens"] },
  "109": { area: "Woodmere", towns: ["Woodmere"] },
  "110": { area: "Lawrence", towns: ["Lawrence", "Woodmere"] },
  // ROUTE 2
  "201": { area: "Local", towns: ["Cedarhurst", "Lawrence"] },
  "202": { area: "Long Island", towns: ["Bethpage", "Farmingdale", "Levittown", "Massapequa", "Massapequa Park", "North Massapequa", "Seaford", "Wantagh"] },
  "203": { area: "Great Neck", towns: ["Kings Point", "Great Neck"] },
  "204": { area: "Woodmere", towns: ["N Woodmere", "Woodmere"] },
  "205": { area: "Local", towns: ["East Rockaway", "Hewlett", "Lynbrook"] },
  "206": { area: "Brooklyn", towns: ["Arverne", "Belle Harbor", "Brooklyn", "Far Rockaway", "Queens", "Rockaway Beach"] },
  "207": { area: "Local", towns: ["Far Rockaway", "Lawrence"] },
  "208": { area: "Hewlett", towns: ["Hewlett", "Hewlett Bay Park", "Woodmere"] },
  "209": { area: "Queens", towns: ["Bayside", "Flushing", "Fresh Meadows", "Hollis", "Jamaica", "Oakland Gardens", "Queens"] },
  "210": { area: "Woodmere", towns: ["Woodmere", "Cedarhurst", "Lawrence"] },
  // ROUTE 3
  "301": { area: "Nassau", towns: ["Franklin Square", "Garden City", "Hempstead", "Oceanside", "West Hempstead"] },
  "302": { area: "Lawrence", towns: ["Lawrence"] },
  "303": { area: "Brooklyn", towns: ["Brooklyn"] },
  "304": { area: "Queens", towns: ["Bellerose", "Cambria Heights", "Elmont", "Floral Park", "Flushing", "Great Neck", "Queens", "Queens Village", "Saint Albans"] },
  "305": { area: "Local", towns: ["Woodmere", "Hewlett"] },
  "306": { area: "West Hempstead", towns: ["Franklin Square", "West Hempstead"] },
  "307": { area: "Westchester", towns: ["Bronx", "Bronxville", "Larchmont", "Mamaroneck", "New Rochelle", "Pelham", "Scarsdale", "Tuckahoe", "Yonkers"] },
  "308": { area: "Local", towns: ["Baldwin", "East Rockaway", "Oceanside"] },
  "309": { area: "Brooklyn", towns: ["Brooklyn"] },
  "310": { area: "Local", towns: ["Cedarhurst", "Lawrence", "Woodmere"] },
  // ROUTE 4
  "401": { area: "Great Neck", towns: ["Great Neck Estates", "Douglaston", "Little Neck"] },
  "402": { area: "Woodmere", towns: ["Woodmere"] },
  "403": { area: "Local", towns: ["Cedarhurst", "Woodmere"] },
  "404": { area: "Great Neck", towns: ["Great Neck", "Kings Point", "Arverne"] },
  "406": { area: "Local", towns: ["N Woodmere", "Cedarhurst"] },
  "407": { area: "Cedarhurst", towns: ["Cedarhurst"] },
  "408": { area: "Long Island", towns: ["Baldwin", "Hewlett", "Lynbrook", "Malverne", "Rockville Centre", "Valley Stream", "West Hempstead"] },
  "409": { area: "Local", towns: ["Bayswater", "Inwood"] },
  "410": { area: "Great Neck", towns: ["Great Neck", "Kings Point"] },
  // ROUTE 5
  "501": { area: "Local", towns: ["Inwood", "Lawrence", "Cedarhurst"] },
  "502": { area: "Local", towns: ["Lawrence", "Cedarhurst"] },
  "503": { area: "Long Island", towns: ["Bellmore", "East Meadow", "Freeport", "Merrick", "North Bellmore", "Roosevelt", "Valley Stream", "Wantagh"] },
  "504": { area: "Long Beach", towns: ["Island Park", "Lido Beach", "Long Beach"] },
  "505": { area: "Local", towns: ["Lawrence", "Cedarhurst"] },
  "506": { area: "Brooklyn", towns: ["Brooklyn"] },
  "507": { area: "Great Neck", towns: ["Great Neck Estates"] },
  "508": { area: "Local", towns: ["Cedarhurst", "Lawrence", "Woodmere"] },
  "509": { area: "Great Neck", towns: ["Garden City", "Great Neck", "Manhasset", "New Hyde Park", "Port Washington", "Roslyn", "Roslyn Heights", "Williston Park"] },
  "510": { area: "Woodmere", towns: ["Woodmere"] },
  // ROUTE 6 (Westchester / Great Neck heavy)
  "602": { area: "Westchester", towns: ["Hartsdale", "Scarsdale", "White Plains"] },
  "603": { area: "Great Neck", towns: ["Great Neck"] },
  "608": { area: "Great Neck", towns: ["Great Neck", "Kings Point"] },
  "609": { area: "Westchester", towns: ["Harrison", "Katonah", "Mamaroneck", "Port Chester", "Pound Ridge", "Purchase", "Rye", "South Salem", "West Harrison", "White Plains"] },
  // Specials
  WF1: { area: "Local", towns: [] },
  WF2: { area: "Local", towns: [] },
  WG1: { area: "Great Neck", towns: ["Great Neck"] },
  RI1: { area: "Local", towns: [] },
  RLW: { area: "Local", towns: [] },
  ANT: { area: "Ant day", towns: [] },
  TRN: { area: "Training", towns: [] },
  TMP: { area: "Temp", towns: [] },
  ASAP: { area: "ASAP", towns: [] },
};

/** Normalize a Pocomos route_code to a daycode key: strip "(P)", suffixes, spaces. */
export function normalizeDaycode(code: string): string {
  return String(code || "")
    .toUpperCase()
    .replace(/\(P\)|\bP\b/g, "")
    .replace(/[^0-9A-Z]/g, "")
    .trim();
}

/** Area label for a daycode, or "" if unknown (shown as the raw code). */
export function daycodeArea(code: string): string {
  return R[normalizeDaycode(code)]?.area ?? "";
}

/** Detailed towns for a daycode (may be empty). */
export function daycodeTowns(code: string): string[] {
  return R[normalizeDaycode(code)]?.towns ?? [];
}

/** True when a daycode is an ANT (ant-treatment) day — needs 3 dry days. */
export function isAntDaycode(code: string): boolean {
  return /ANT/.test(normalizeDaycode(code));
}
