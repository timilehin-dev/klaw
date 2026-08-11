// Modal Endpoint URLs (Passed via Env)
const KIMI_K3_URL = process.env.KIMI_K3_URL || "https://timilehinolajide32--ep-kimi-k3-server.us-west.modal.direct";
const DEEPSEEK_V4_URL = process.env.DEEPSEEK_V4_URL || "https://your-deepseek-modal-url.modal.direct"; // Replace with actual URL

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
};

export async function callLLM(
  model: "kimi-k3" | "deepseek-v4-pro",
  systemPrompt: string,
  messages: LLMMessage[],
  tools?: any[]
): Promise<any> {
  // We use OpenAI-compatible format since Modal endpoints usually expose this
  const endpoint = model === "kimi-k3" ? KIMI_K3_URL : DEEPSEEK_V4_URL;

  // For Phase 2, we'll just do a standard chat completion.
  // In Phase 3, we will expand this to support function/tool calling natively.
  const payload = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    // tools reserved for Phase 3
    ...(tools ? { tools } : {}),
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // "Authorization": `Bearer ${process.env.MODAL_KEY}` // Add if your Modal endpoint requires auth
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Modal LLM Error: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}
