"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/dashboard", label: "Inbox" },
  { href: "/dashboard", label: "Threads" },
  { href: "/dashboard", label: "Cabinet" },
  { href: "/dashboard", label: "Skills" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border bg-surface flex flex-col p-4 gap-6">
      <Link href="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary" />
        <h1 className="font-semibold text-sm tracking-tight">Klaw</h1>
      </Link>

      <nav className="flex flex-col gap-1 text-sm">
        <div className="text-text-muted uppercase text-xs tracking-wider mb-2">
          Workspace
        </div>
        {nav.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`text-left px-2 py-1.5 rounded-md hover:bg-background ${
                active && item.label === "Inbox"
                  ? "text-primary font-medium"
                  : "text-text-muted"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto text-[11px] text-text-muted leading-relaxed">
        Architectural Workbench
        <br />
        Phase 6 dashboard
      </div>
    </aside>
  );
}
