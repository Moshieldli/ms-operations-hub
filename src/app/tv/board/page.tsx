import { getScheduleBoard } from "@/lib/service/scheduleBoard";
import { getActiveShoutouts } from "@/lib/service/compliments";
import { TvBoardView } from "@/components/tv-board-view";

// Reads mutable caches → force no caching (stale-zeros lesson).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 60;

export default async function TvBoardPage() {
  let board: Awaited<ReturnType<typeof getScheduleBoard>> | null = null;
  let shoutouts: Awaited<ReturnType<typeof getActiveShoutouts>> = [];
  try {
    [board, shoutouts] = await Promise.all([getScheduleBoard(), getActiveShoutouts()]);
  } catch {
    board = null;
  }
  return <TvBoardView board={board} shoutouts={shoutouts} />;
}
