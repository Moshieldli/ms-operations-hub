import { FollowupView } from "@/components/followup-view";
import { getFollowupReport, type FollowupReport } from "@/lib/leads/followup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /leads/followup — reads the leads_followup cache only (instant; never scrapes
 * on load). The nightly cron or the page's "Refresh now" button fills it.
 */
export default async function LeadsFollowupPage() {
  let report: FollowupReport | null = null;
  let error: string | null = null;
  try {
    report = await getFollowupReport();
  } catch (e) {
    error = (e as Error).message;
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Overdue follow-ups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&rsquo;t load the follow-up report: {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  return <FollowupView initial={report} />;
}
