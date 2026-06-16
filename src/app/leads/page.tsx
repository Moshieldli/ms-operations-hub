import { LeadsView } from "@/components/leads-view";
import { getCachedReport, type LeadsCloseRateReport } from "@/lib/leads/closeRate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function LeadsPage() {
  let initial: LeadsCloseRateReport | null = null;
  try {
    initial = await getCachedReport();
  } catch {
    initial = null;
  }
  return <LeadsView initial={initial} />;
}
