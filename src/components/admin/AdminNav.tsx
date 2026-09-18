"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar navigation in the register of mastersunion.org's header: uppercase,
// tracked-out labels on ink. The current section carries the brand gradient
// as a thin marker — the only colour in the rail.

const ITEMS = [
  { href: "/admin", label: "Dashboard", match: (p: string) => p === "/admin" || p.startsWith("/admin/pages") },
  { href: "/admin/projects", label: "Lovable projects", match: (p: string) => p.startsWith("/admin/projects") },
  { href: "/admin/import", label: "Paste import", match: (p: string) => p.startsWith("/admin/import") },
  { href: "/admin/media", label: "Media", match: (p: string) => p.startsWith("/admin/media") },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Admin">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-full px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              active ? "bg-white/10 text-white" : "text-neutral-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            {active ? <span aria-hidden className="brand-gradient absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full" /> : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
