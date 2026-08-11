"use client";

type Artifact = {
  id: string;
  type: string;
  file_path: string | null;
};

export default function Cabinet({
  artifacts = [],
}: {
  artifacts?: Artifact[];
}) {
  return (
    <aside className="w-80 flex-shrink-0 bg-surface flex flex-col p-4 gap-4 hidden lg:flex border-l border-border">
      <h2 className="font-semibold text-sm tracking-tight border-b border-border pb-2">
        Cabinet
      </h2>

      {artifacts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-border rounded-lg p-4">
          <div className="h-10 w-10 rounded-md bg-background mb-2" />
          <p className="text-xs text-text-muted">
            Generated artifacts (PDFs, code, CSVs) will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {artifacts.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs"
            >
              <div className="font-medium uppercase tracking-wide text-text-muted">
                {a.type}
              </div>
              <div className="truncate mt-0.5 font-mono text-[11px]">
                {a.file_path || "untitled"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
