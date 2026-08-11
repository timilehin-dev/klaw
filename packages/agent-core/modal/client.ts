// Client to call the Modal Sandbox execution endpoint
// Lives in @klaw/core so the agent loop does not import from apps/web

const MODAL_EXECUTE_URL =
  process.env.MODAL_EXECUTE_URL ||
  "https://your-workspace--klaw-sandbox-execute-code.modal.run";

export type SandboxResult = {
  success: boolean;
  stdout: string;
  stderr: string;
};

export async function executeCodeInSandbox(code: string): Promise<SandboxResult> {
  const response = await fetch(MODAL_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // "Authorization": `Bearer ${process.env.MODAL_KEY}` // Add if your Modal endpoint requires auth
    },
    body: JSON.stringify({ code }),
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
