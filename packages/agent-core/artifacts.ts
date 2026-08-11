/**
 * Map Modal sandbox file outputs → Supabase `artifacts` rows + durable paths.
 */

export type SandboxFileLike = {
  name: string;
  path: string;
  size: number;
  media_type?: string;
  content_base64: string;
};

export type ArtifactRecord = {
  thread_id: string;
  type: string;
  file_path: string;
  metadata: Record<string, unknown>;
};

/** Infer artifact type from filename / media type */
export function inferArtifactType(
  fileName: string,
  mediaType?: string
): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mediaType?.includes("pdf")) return "pdf";
  if (lower.endsWith(".docx") || mediaType?.includes("wordprocessingml"))
    return "docx";
  if (lower.endsWith(".csv") || mediaType?.includes("csv")) return "csv";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    mediaType?.startsWith("image/")
  )
    return "image";
  if (
    lower.endsWith(".py") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".json") ||
    lower.endsWith(".sql") ||
    mediaType?.includes("javascript") ||
    mediaType?.includes("json")
  )
    return "code";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "csv";
  return "code";
}

/**
 * Build durable file_path. Uses data URL for small files so Cabinet works
 * without Supabase Storage setup; larger files keep a logical /mnt/data path.
 */
export function buildDurableFilePath(file: SandboxFileLike): string {
  const maxInline = 1_500_000; // ~1.5MB base64 budget
  const media = file.media_type || "application/octet-stream";
  if (file.content_base64 && file.content_base64.length <= maxInline) {
    return `data:${media};base64,${file.content_base64}`;
  }
  return `/mnt/data/${file.path.replace(/^\/+/, "")}`;
}

/** Pure mapping: sandbox files → artifact insert rows */
export function mapSandboxFilesToArtifacts(
  threadId: string,
  files: SandboxFileLike[],
  extraMeta: Record<string, unknown> = {}
): ArtifactRecord[] {
  return (files || []).map((f) => {
    const type = inferArtifactType(f.name || f.path, f.media_type);
    return {
      thread_id: threadId,
      type,
      file_path: buildDurableFilePath(f),
      metadata: {
        name: f.name,
        path: f.path,
        size: f.size,
        media_type: f.media_type || null,
        ...extraMeta,
      },
    };
  });
}
