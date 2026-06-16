import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OverdueView } from "@/components/overdue-view";
import { getOverdueReport, type OverdueReport } from "@/lib/service/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OverduePage() {
  let report: OverdueReport | null = null;
  let error: string | null = null;
  try {
    report = await getOverdueReport();
  } catch (e) {
    error = (e as Error).message;
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Couldn&rsquo;t load the overdue report</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The database may be unavailable. Try again shortly.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />
      <OverdueView initial={report} />
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overdue Sprays</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Active mosquito customers with no mosquito service in 15+ days.
        </p>
      </div>
      <Link
        href="/service"
        className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
      >
        ← Service
      </Link>
    </div>
  );
}
