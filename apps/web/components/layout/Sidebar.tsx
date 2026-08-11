"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ThreadRow = {
  id: string;
  status: string | null;
  created_at: string;
  preview?: string;
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeThread = searchParams.get("thread");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/threads");
      const json = await res.json();
      if (res.ok && Array.isArray(json.threads)) {
        setThreads(json.threads);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pathname?.startsWith("/dashboard")) {
      void loadThreads();
      const t = setInterval(() => void loadThreads(), 8000);
      return () => clearInterval(t);
    }
  }, [pathname, loadThreads]);

  const openThread = (id: string) => {
    router.push(`/dashboard?thread=${id}`);
  };

  const newThread = async () => {
    const res = await fetch("/api/threads", { method: "POST" });
    const json = await res.json();
    if (res.ok && json.id) {
      await loadThreads();
      router.push(`/dashboard?thread=${json.id}`);
    }
  };

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border bg-surface flex flex-col p-4 gap-4">
      <Link href="/" className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary" />
        <h1 className="font-semibold text-sm tracking-tight">Klaw</h1>
      </Link>

      <div className="flex items-center justify-between">
        <div className="text-text-muted uppercase text-xs tracking-wider">
          Threads
        </div>
        <button
          type="button"
          onClick={() => void newThread()}
          className="text-xs text-primary hover:underline"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {loading && threads.length === 0 && (
          <p className="text-[11px] text-text-muted px-1">Loading…</p>
        )}
        {threads.length === 0 && !loading && (
          <p className="text-[11px] text-text-muted px-1">
            No threads yet. Create one to chat.
          </p>
        )}
        {threads.map((t) => {
          const active = activeThread === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => openThread(t.id)}
              className={`text-left px-2 py-1.5 rounded-md text-xs hover:bg-background ${
                active
                  ? "bg-background text-primary font-medium border border-border"
                  : "text-text-muted"
              }`}
            >
              <div className="font-mono truncate">
                {t.id.substring(0, 8)}…
              </div>
              <div className="truncate opacity-70 mt-0.5">
                {t.preview || t.status || "active"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-auto text-[11px] text-text-muted leading-relaxed">
        Architectural Workbench
        <br />
        Free public MCP enabled
      </div>
    </aside>
  );
}
