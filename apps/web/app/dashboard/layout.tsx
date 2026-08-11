import { Suspense } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Cabinet from "@/components/layout/Cabinet";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-text">
      <Suspense fallback={<aside className="w-60 border-r border-border" />}>
        <Sidebar />
      </Suspense>

      <main className="flex-1 flex flex-col min-w-0 border-r border-border bg-background">
        <Suspense fallback={<div className="p-4 text-sm text-text-muted">Loading…</div>}>
          {children}
        </Suspense>
      </main>

      <Suspense fallback={<aside className="w-80 border-l border-border hidden lg:block" />}>
        <Cabinet />
      </Suspense>
    </div>
  );
}
