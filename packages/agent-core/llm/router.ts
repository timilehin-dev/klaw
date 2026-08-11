export type ModelId = "kimi-k3" | "deepseek-v4-pro";

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

const KIMI_K3_URL =
  process.env.KIMI_K3_URL ||
  "https://timilehinolajide32--ep-kimi-k3-server.us-west.modal.direct";

const DEEPSEEK_V4_URL =
  process.env.DEEPSEEK_V4_URL ||
  "https://your-deepseek-v4-url.modal.direct";

/**
 * Dual-model policy for Klaw:
 * - **kimi-k3** — default agentic model for tool calling / skill execution
 * - **deepseek-v4-pro** — deep reasoning, code review, pure analysis (often no tools)
 */
export function selectModel(purpose: "agentic" | "reasoning"): ModelId {
  return purpose === "reasoning" ? "deepseek-v4-pro" : "kimi-k3";
}

export function getModelEndpoint(model: ModelId): string {
  const endpoint = model === "kimi-k3" ? KIMI_K3_URL : DEEPSEEK_V4_URL;
  if (!endpoint) {
    throw new Error(`No Modal endpoint configured for model: ${model}`);
  }
  return endpoint;
}

/**
 * Call a Modal-hosted OpenAI-compatible LLM endpoint.
 * Returns the assistant message: { role, content, tool_calls? }
 */
export async function callLLM(
  model: ModelId,
  systemPrompt: string,
  messages: LLMMessage[],
  tools?: any[]
): Promise<LLMMessage> {
  const endpoint = getModelEndpoint(model);

  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  // Tools only when provided (agentic path). Reasoning path omits them.
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Modal LLM Error (${model}): ${response.statusText}${
        errorBody ? ` — ${errorBody}` : ""
      }`
    );
  }

  const data = await response.json();
  return data.choices[0].message;
}

/**
 * Self-healing: DeepSeek V4 Pro rewrites failing Python given the error.
 * Returns only the corrected source (markdown fences stripped when present).
 */
export async function fixCodeWithDeepSeek(
  originalCode: string,
  errorMessage: string
): Promise<string> {
  const fixPrompt = [
    "The following Python code failed with this error:",
    "",
    "Code:",
    "```python",
    originalCode,
    "```",
    "",
    "Error:",
    errorMessage,
    "",
    "Please return ONLY the corrected Python code block, nothing else.",
    "Keep using the /mnt/data workspace for any file outputs.",
  ].join("\n");

  const response = await callLLM(
    "deepseek-v4-pro",
    "You are an expert Python debugger. Return only corrected code.",
    [{ role: "user", content: fixPrompt }]
  );

  const content = response.content || "";
  const match =
    content.match(/```python\n([\s\S]*?)\n```/) ||
    content.match(/```\n([\s\S]*?)\n```/);
  return (match ? match[1] : content).trim();
}
