import { Inngest } from "inngest";
import { callLLM, LLMMessage } from "./llm/router";

// Shared Inngest client — Next.js API routes and agent functions must use the same instance
export const inngest = new Inngest({ id: "klaw" });

// The Core Agent Function
export const handleAgentTask = inngest.createFunction(
  {
    id: "agent-handle-task",
    retries: 3,
  },
  { event: "task/received" },
  async ({ event, step, logger }) => {
    const { threadId, message, triggerSource } = event.data;

    // 1. Acquire Redis Lock (Prevent race conditions if user double-posts)
    await step.run("acquire-lock", async () => {
      // Redis logic will go here in Phase 3
      logger.info(`Lock acquired for thread: ${threadId}`);
    });

    // 2. Load System Prompt & History
    const systemPrompt = await step.run("load-context", async () => {
      return `You are an expert AI assistant. A user sent you a message from ${triggerSource}. Help them accomplish their goal.`;
    });

    // 3. The Durable Agent Loop (Think -> Act -> Observe)
    let iterations = 0;
    let done = false;
    let messages: LLMMessage[] = [
      { role: "user", content: message }
    ];

    // We cap iterations to prevent infinite loops and save costs
    while (!done && iterations < 10) {
      iterations++;

      // THINK: Call Kimi K3 via Modal
      const llmResponse = await step.run(`think-${iterations}`, async () => {
        logger.info(`Calling Kimi K3 for iteration ${iterations}...`);
        const response = await callLLM("kimi-k3", systemPrompt, messages);
        return response.choices[0].message;
      });

      // For Phase 2, we assume no tool calls yet (just conversational)
      // In Phase 3, we will intercept tool_calls here and route to Modal Sandbox
      if (llmResponse.content) {
        done = true;

        // 4. Save & Reply
        await step.run("save-response", async () => {
          logger.info("Agent finished. Saving response.");
          // Supabase logic to save message will go here
        });

        return {
          success: true,
          response: llmResponse.content,
          iterations: iterations
        };
      }
    }

    return { success: false, error: "Max iterations reached without final response." };
  }
);

export { callLLM } from "./llm/router";
export type { LLMMessage } from "./llm/router";
