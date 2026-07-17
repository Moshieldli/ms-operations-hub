"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NavLink {
  href: string;
  label: string;
  /** When present the tab becomes a dropdown; `href` is still the tab's landing page. */
  children?: Array<{ href: string; label: string }>;
}

const links: NavLink[] = [
  { href: "/sales", label: "Sales" },
  {
    href: "/leads",
    label: "Leads",
    children: [
      { href: "/leads", label: "Close rate" },
      { href: "/leads/followup", label: "Follow-ups" },
    ],
  },
  { href: "/calling", label: "Calling" },
  { href: "/combined", label: "Combined" },
  { href: "/service", label: "Service" },
  { href: "/texting", label: "Texting" },
];

/** A tab is active on its own page AND on any page beneath it. */
const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          MS Operations Hub
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) =>
            link.children ? (
              <NavDropdown key={link.href} link={link} pathname={pathname} />
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={cn(tabClass, activeClass(isActive(pathname, link.href)))}
              >
                {link.label}
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
  );
}

const tabClass = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
const activeClass = (active: boolean) =>
  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * Click-driven dropdown — NOT hover: a hover menu is unreachable on touch, and
 * this nav is used on phones. Closes on outside click, Escape, or navigation.
 */
function NavDropdown({ link, pathname }: { link: NavLink; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isActive(pathname, link.href);

  // Close when the route changes (the menu would otherwise stay open on tap-through).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(tabClass, activeClass(active), "inline-flex items-center gap-1")}
      >
        {link.label}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[10rem] overflow-hidden rounded-md border bg-background p-1 shadow-md"
        >
          {link.children!.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "block rounded-sm px-3 py-2 text-sm transition-colors",
                pathname === c.href
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {c.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
