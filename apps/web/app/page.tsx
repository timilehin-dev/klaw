import Link from "next/link";

export default function Home() {
  return (
    <main className="flex h-screen flex-col items-center justify-center p-24">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-lg bg-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Klaw</h1>
        <p className="text-text-muted">Architectural Workbench</p>
        <Link
          href="/dashboard"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
