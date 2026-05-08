"use client";

import { usePathname } from "next/navigation";
import { Nav } from "./nav";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTv = pathname?.startsWith("/tv");

  if (isTv) {
    return <main className="min-h-screen w-full">{children}</main>;
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
