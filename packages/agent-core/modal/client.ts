// Client to call the Modal Sandbox execution endpoint
// Lives in @klaw/core so the agent loop does not import from apps/web

const MODAL_EXECUTE_URL =
  process.env.MODAL_EXECUTE_URL ||
  "https://your-workspace--klaw-sandbox-execute-code.modal.run";

export type SandboxFile = {
  name: string;
  path: string;
  size: number;
  media_type?: string;
  content_base64: string;
};

export type SandboxResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  files?: SandboxFile[];
  duration_ms?: number;
  error_type?: string | null;
  meta?: Record<string, unknown>;
};

export type ExecuteCodeOptions = {
  /** Optional map of relative path -> base64 content to stage in the workspace */
  files?: Record<string, string>;
  /** Soft execution limit in seconds (capped by the Modal function timeout) */
  timeoutSeconds?: number;
  /** Optional pip packages for rare deps not in the fat image */
  dependencies?: string[];
};

/**
 * Execute code in the Modal sandbox.
 * Overload-friendly: second arg may be a dependencies string[] (Phase 5.1 style)
 * or a full options object.
 */
export async function executeCodeInSandbox(
  code: string,
  optionsOrDeps: ExecuteCodeOptions | string[] = {}
): Promise<SandboxResult> {
  const options: ExecuteCodeOptions = Array.isArray(optionsOrDeps)
    ? { dependencies: optionsOrDeps }
    : optionsOrDeps || {};

  const body: Record<string, unknown> = { code };
  if (options.files && Object.keys(options.files).length > 0) {
    body.files = options.files;
  }
  if (options.timeoutSeconds != null) {
    body.timeout_seconds = options.timeoutSeconds;
  }
  if (options.dependencies && options.dependencies.length > 0) {
    body.dependencies = options.dependencies;
  }

  const response = await fetch(MODAL_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return {
      success: false,
      stdout: "",
      stderr: `Modal API Error: ${response.status} ${response.statusText}`,
    };
  }

  return await response.json();
}
