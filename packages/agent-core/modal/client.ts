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
};

export async function executeCodeInSandbox(
  code: string,
  options: ExecuteCodeOptions = {}
): Promise<SandboxResult> {
  const body: Record<string, unknown> = { code };
  if (options.files && Object.keys(options.files).length > 0) {
    body.files = options.files;
  }
  if (options.timeoutSeconds != null) {
    body.timeout_seconds = options.timeoutSeconds;
  }

  const response = await fetch(MODAL_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // "Authorization": `Bearer ${process.env.MODAL_KEY}` // Add if endpoint requires auth
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
