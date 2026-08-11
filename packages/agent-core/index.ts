import { Inngest } from "inngest";
import { callLLM, LLMMessage } from "./llm/router";
import { agentTools } from "./tools/definitions";
import { executeCodeInSandbox } from "./modal/client";

// Shared Inngest client — Next.js API routes and agent functions must use the same instance
export const inngest = new Inngest({ id: "klaw" });

// The Core Agent Function with Think -> Act -> Observe tool loop
export const handleAgentTask = inngest.createFunction(
  {
    id: "agent-handle-task",
    retries: 3,
  },
  { event: "task/received" },
  async ({ event, step, logger }) => {
    const { threadId, message, triggerSource } = event.data;

    // 1. Acquire lock (full Redis lock in later phase)
    await step.run("acquire-lock", async () => {
      logger.info(`Lock acquired for thread: ${threadId}`);
    });

    // 2. Load system prompt & context
    const systemPrompt = await step.run("load-context", async () => {
      return `You are Klaw, an expert AI assistant. A user sent you a message from ${triggerSource}. You can use the execute_code tool to run Python in a secure sandbox for calculations, data analysis, and file generation. Prefer tools when computation is needed. Help them accomplish their goal.`;
    });

    // 3. Durable agent loop (Think -> Act -> Observe)
    let iterations = 0;
    let done = false;
    const messages: LLMMessage[] = [{ role: "user", content: message }];

    while (!done && iterations < 10) {
      iterations++;

      // THINK: Call Kimi K3 via Modal with tool definitions
      const llmResponse = await step.run(`think-${iterations}`, async () => {
        logger.info(`Calling Kimi K3 for iteration ${iterations}...`);
        const response = await callLLM(
          "kimi-k3",
          systemPrompt,
          messages,
          agentTools
        );
        return response.choices[0].message;
      });

      // Keep assistant turn in history (including tool_calls)
      messages.push({
        role: "assistant",
        content: llmResponse.content ?? null,
        tool_calls: llmResponse.tool_calls,
      });

      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        // ACT: Execute each tool call in Modal sandbox
        for (const toolCall of llmResponse.tool_calls) {
          const toolResult = await step.run(
            `act-${iterations}-${toolCall.id}`,
            async () => {
              const name = toolCall.function?.name as string;
              let args: { code?: string } = {};
              try {
                args = JSON.parse(toolCall.function?.arguments || "{}");
              } catch {
                return {
                  success: false,
                  stdout: "",
                  stderr: "Failed to parse tool arguments as JSON",
                };
              }

              if (name === "execute_code") {
                logger.info("Executing code in Modal sandbox...");
                return await executeCodeInSandbox(args.code || "");
              }

              return {
                success: false,
                stdout: "",
                stderr: `Unknown tool: ${name}`,
              };
            }
          );

          // OBSERVE: Feed tool result back to the LLM
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
        // Loop continues — LLM processes tool results next iteration
      } else if (llmResponse.content) {
        // No tool calls — final answer
        done = true;

        await step.run("save-response", async () => {
          logger.info("Agent finished. Final response generated.");
          // TODO: Save to Supabase in Phase 4
        });

        return {
          success: true,
          response: llmResponse.content,
          iterations,
        };
      } else {
        // Fallback if response is empty
        done = true;
        return { success: false, error: "Empty response from LLM" };
      }
    }

    return { success: false, error: "Max iterations reached" };
  }
);

export { callLLM } from "./llm/router";
export type { LLMMessage } from "./llm/router";
export { agentTools } from "./tools/definitions";
export { executeCodeInSandbox } from "./modal/client";
export type { SandboxResult } from "./modal/client";
