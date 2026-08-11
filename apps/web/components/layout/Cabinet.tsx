"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Artifact = {
  id: string;
  type: string;
  file_path: string | null;
  metadata?: { name?: string; size?: number } | null;
};

export default function Cabinet() {
  const searchParams = useSearchParams();
  const threadId = searchParams.get("thread");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  const load = useCallback(async () => {
    if (!threadId) {
      setArtifacts([]);
      return;
    }
    const res = await fetch(`/api/threads/${threadId}`);
    if (!res.ok) return;
    const json = await res.json();
    if (Array.isArray(json.artifacts)) setArtifacts(json.artifacts);
  }, [threadId]);

  useEffect(() => {
    void load();
    if (!threadId) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [load, threadId]);

  return (
    <aside className="w-80 flex-shrink-0 bg-surface flex flex-col p-4 gap-4 hidden lg:flex border-l border-border">
      <h2 className="font-semibold text-sm tracking-tight border-b border-border pb-2">
        Cabinet
      </h2>

      {!threadId && (
        <p className="text-xs text-text-muted">
          Select a thread to view artifacts.
        </p>
      )}

      {threadId && artifacts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-border rounded-lg p-4">
          <div className="h-10 w-10 rounded-md bg-background mb-2" />
          <p className="text-xs text-text-muted">
            Generated artifacts (PDFs, code, CSVs) will appear here after
            sandbox runs.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {artifacts.map((a) => {
            const name =
              (a.metadata as any)?.name ||
              a.file_path?.split("/").pop()?.slice(0, 40) ||
              "file";
            const isData = a.file_path?.startsWith("data:");
            return (
              <li
                key={a.id}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs"
              >
                <div className="font-medium uppercase tracking-wide text-text-muted">
                  {a.type}
                </div>
                <div className="truncate mt-0.5 font-mono text-[11px]">
                  {name}
                </div>
                {a.file_path && (
                  <a
                    href={a.file_path}
                    download={isData ? String(name) : undefined}
                    target={isData ? undefined : "_blank"}
                    rel="noreferrer"
                    className="text-primary text-[11px] hover:underline mt-1 inline-block"
                  >
                    Open
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
