import { getSupabase } from "./clients";
import {
  mapSandboxFilesToArtifacts,
  type SandboxFileLike,
} from "./artifacts";

/**
 * Persist sandbox-generated files as artifact rows for the Cabinet UI.
 * Returns number of rows inserted.
 */
export async function persistSandboxArtifacts(
  threadId: string,
  files: SandboxFileLike[] | undefined | null,
  extraMeta: Record<string, unknown> = {}
): Promise<number> {
  if (!files || files.length === 0) return 0;
  const rows = mapSandboxFilesToArtifacts(threadId, files, extraMeta);
  if (rows.length === 0) return 0;

  const { error } = await getSupabase().from("artifacts").insert(rows);
  if (error) {
    console.error("persistSandboxArtifacts:", error.message);
    throw new Error(`persistSandboxArtifacts failed: ${error.message}`);
  }
  return rows.length;
}
