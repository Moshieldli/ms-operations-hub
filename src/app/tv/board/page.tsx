import { getScheduleBoard } from "@/lib/service/scheduleBoard";
import { TvBoardView } from "@/components/tv-board-view";

// Reads the mutable mosquito-status cache → force no caching (stale-zeros lesson).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 60;

export default async function TvBoardPage() {
  let board: Awaited<ReturnType<typeof getScheduleBoard>> | null = null;
  try {
    board = await getScheduleBoard();
  } catch {
    board = null;
  }
  return <TvBoardView board={board} />;
}
