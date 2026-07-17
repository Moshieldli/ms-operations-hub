import { PausedBalanceCard } from "@/components/service-rows";
import { RefreshedAt } from "@/components/refreshed-at";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOverdueReport, type OverdueReport } from "@/lib/service/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /finance — money-side of operations. Today it hosts the "Service paused —
 * open balance" roster (the SAME shared PausedBalanceCard the /service/overdue
 * page renders in place — the data comes from getOverdueReport()). Built with
 * room to grow: the next tenant is payment-retry review.
 */
export default async function FinancePage() {
  let report: OverdueReport | null = null;
  let error: string | null = null;
  try {
    report = await getOverdueReport();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts where money is blocking service. Payment-retry review is
          coming here next.
        </p>
      </div>

      {!report ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&rsquo;t load the finance report</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The database may be unavailable. Try again shortly.
          </CardContent>
        </Card>
      ) : (
        <PausedBalanceCard
          rows={report.pausedBalance}
          asOf={
            report.lastRefreshedAt ? (
              <span className="text-muted-foreground">
                Updated <RefreshedAt asOf={report.lastRefreshedAt} />.
              </span>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
