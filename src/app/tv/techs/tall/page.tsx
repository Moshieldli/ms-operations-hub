import { TvTechsTallView } from "@/components/tv-techs-tall-view";
import { getTechBoard } from "@/lib/service/tech-board";
import { getForecast } from "@/lib/weather";

// Same mutable-cache rule as /tv/techs: the nightly crons rewrite the tables this
// reads, so nothing here may be cached. The weather's 30-min TTL therefore lives
// in lib/weather.ts (a module memo), not in Next's fetch cache — `force-no-store`
// would bypass it. Weather fails soft: getForecast() returns null and the strip
// is omitted rather than taking down the board.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function TvTechsTallPage() {
  const [board, forecast] = await Promise.all([getTechBoard(), getForecast()]);
  return <TvTechsTallView board={board} forecast={forecast} />;
}
