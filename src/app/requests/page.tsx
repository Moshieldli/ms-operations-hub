import { listFeedback } from "@/lib/feedback";
import { RequestsView } from "@/components/requests-view";

// Reads the mutable `feedback` table on every load — force no caching so a
// just-submitted item shows immediately (the /leads/followup stale-zeros lesson).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function RequestsPage() {
  let items: Awaited<ReturnType<typeof listFeedback>> = [];
  let error: string | null = null;
  try {
    items = await listFeedback();
  } catch (e) {
    error = (e as Error).message;
  }
  return <RequestsView initial={items} error={error} />;
}
