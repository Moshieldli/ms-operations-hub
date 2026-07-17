import Link from "next/link";
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
  return (
    <div className="space-y-4">
      {/* Sub-nav: the Leads section now has more than one report. */}
      <div className="flex gap-4 text-sm">
        <span className="font-medium">Close rate</span>
        <Link
          href="/leads/followup"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Overdue follow-ups →
        </Link>
      </div>
      <LeadsView initial={initial} />
    </div>
  );
}
