import { getScheduleBoard } from "@/lib/service/scheduleBoard";
import { getRosterNames, listShoutouts } from "@/lib/service/compliments";
import { ServiceBoardView } from "@/components/service-board-view";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 60;

export default async function ServiceBoardPage({
  searchParams,
}: {
  searchParams?: { week?: string };
}) {
  let board: Awaited<ReturnType<typeof getScheduleBoard>> | null = null;
  let roster: string[] = [];
  let shoutouts: Awaited<ReturnType<typeof listShoutouts>> = [];
  try {
    // ?week=YYYY-MM-DD reviews a past/future week (rev 62) — admin page only;
    // the TV route never passes an override.
    [board, roster, shoutouts] = await Promise.all([
      getScheduleBoard({ weekOf: searchParams?.week }),
      getRosterNames(),
      listShoutouts(),
    ]);
  } catch {
    board = null;
  }
  return <ServiceBoardView board={board} roster={roster} shoutouts={shoutouts} />;
}
