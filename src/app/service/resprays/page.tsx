import { RespraysView } from "@/components/resprays-view";
import {
  getRespraysReport,
  CADENCE_MAX_DAYS,
  CADENCE_MIN_DAYS,
  FLAG_MIN_APPLICATIONS,
  FLAG_RATE_MULTIPLE,
  RESPRAY_MAX_GAP_DAYS,
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
        maxGapDays: RESPRAY_MAX_GAP_DAYS,
        cadenceMin: CADENCE_MIN_DAYS,
        cadenceMax: CADENCE_MAX_DAYS,
        flagMultiple: FLAG_RATE_MULTIPLE,
        flagMinApplications: FLAG_MIN_APPLICATIONS,
      }}
    />
  );
}
