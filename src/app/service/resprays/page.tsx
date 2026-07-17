import { RespraysView } from "@/components/resprays-view";
import {
  getRespraysReport,
  FLAG_MIN_APPLICATIONS,
  FLAG_RATE_MULTIPLE,
  WEEKLY_CALLOUT_MIN_APPS,
  type RespraysReport,
} from "@/lib/service/resprays";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reads the respray_jobs cache only — never calls Pocomos on load. */
export default async function RespraysPage() {
  let report: RespraysReport | null = null;
  let error: string | null = null;
  try {
    report = await getRespraysReport();
  } catch (e) {
    error = (e as Error).message;
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tech respray performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&rsquo;t load the respray report: {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <RespraysView
      initial={report}
      rules={{
        flagMultiple: FLAG_RATE_MULTIPLE,
        flagMinApplications: FLAG_MIN_APPLICATIONS,
        weeklyCalloutMinApps: WEEKLY_CALLOUT_MIN_APPS,
      }}
    />
  );
}
