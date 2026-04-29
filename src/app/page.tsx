import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sections = [
  {
    href: "/sales",
    title: "Sales",
    description: "Pipeline, conversions, and rep performance.",
  },
  {
    href: "/calling",
    title: "Calling",
    description: "Outbound call activity and outcomes.",
  },
  {
    href: "/combined",
    title: "Combined",
    description: "Cross-channel view across sales and calling.",
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
