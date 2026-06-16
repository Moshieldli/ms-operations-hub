import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Service reports registry. Adding a new report is a two-step drop-in:
 *   1. add an entry here, and
 *   2. create its page at the `href`.
 * No restructuring needed. `status: "soon"` renders a disabled "Coming soon"
 * card; `status: "live"` renders a clickable card.
 */
type ReportStatus = "live" | "soon";
interface ServiceReport {
  href: string;
  title: string;
  description: string;
  status: ReportStatus;
}

const reports: ServiceReport[] = [
  {
    href: "/service/overdue",
    title: "Overdue Sprays",
    description:
      "Active mosquito customers with no mosquito service in 15+ days.",
    status: "live",
  },
  {
    href: "/service/respray",
    title: "Respray Report",
    description: "Resprays by customer and reason.",
    status: "soon",
  },
  {
    href: "/service/tech-respray",
    title: "Tech Respray Performance",
    description: "Respray rate by technician.",
    status: "soon",
  },
];

export default function ServicePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Service</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Field-service reports from Pocomos service history.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) =>
          r.status === "live" ? (
            <Link key={r.href} href={r.href} className="block">
              <Card className="h-full transition-colors hover:border-foreground">
                <CardHeader>
                  <CardTitle>{r.title}</CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ) : (
            <Card key={r.href} className="h-full opacity-60">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {r.title}
                  <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Coming soon
                  </span>
                </CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
