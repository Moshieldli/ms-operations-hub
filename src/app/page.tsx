import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Mirrors the top-nav taxonomy (rev 59): Customers · Leads · Service · Finance
// · Texting · Requests. New page => new nav entry => (usually) a card here.
const sections = [
  {
    href: "/sales",
    title: "Customers",
    description: "Active roster, season buckets, return rate.",
  },
  {
    href: "/leads",
    title: "Leads",
    description: "Close rate and follow-up state.",
  },
  {
    href: "/service",
    title: "Service",
    description: "Overdue sprays, respray performance, route board.",
  },
  {
    href: "/finance",
    title: "Finance",
    description: "Paused accounts with open balances — collections.",
  },
  {
    href: "/texting",
    title: "Texting",
    description: "Aerialink SMS archive (password-gated).",
  },
  {
    href: "/requests",
    title: "Requests",
    description: "Feedback queue and the prompt builder.",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          MS Operations Hub
        </h1>
        <p className="mt-2 text-muted-foreground">
          Mosquito Shield of Long Island — operations dashboard.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="h-full transition-colors hover:border-foreground">
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
