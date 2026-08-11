export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

/**
 * Call a Modal-hosted OpenAI-compatible LLM endpoint.
 * Returns the assistant message: { role, content, tool_calls? }
 */
export async function callLLM(
  model: "kimi-k3" | "deepseek-v4-pro",
  systemPrompt: string,
  messages: LLMMessage[],
  tools?: any[]
): Promise<LLMMessage> {
  const KIMI_K3_URL =
    process.env.KIMI_K3_URL ||
    "https://timilehinolajide32--ep-kimi-k3-server.us-west.modal.direct";
  const DEEPSEEK_V4_URL =
    process.env.DEEPSEEK_V4_URL || "https://your-deepseek-modal-url.modal.direct";

  const endpoint = model === "kimi-k3" ? KIMI_K3_URL : DEEPSEEK_V4_URL;

  if (!endpoint) {
    throw new Error(`No Modal endpoint configured for model: ${model}`);
  }

  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  // Add tools if provided
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
      `Modal LLM Error: ${response.statusText}${errorBody ? ` — ${errorBody}` : ""}`
    );
  }

  const data = await response.json();
  return data.choices[0].message; // { role, content, tool_calls? }
}
