import Sidebar from "@/components/layout/Sidebar";
import Cabinet from "@/components/layout/Cabinet";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-text">
      {/* Left: Index */}
      <Sidebar />

      {/* Center: Workbench */}
      <main className="flex-1 flex flex-col min-w-0 border-r border-border bg-background">
        {children}
      </main>

      {/* Right: Cabinet (hidden below lg) */}
      <Cabinet />
    </div>
  );
}
