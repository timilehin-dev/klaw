import { Inngest } from "inngest";
import { callLLM, LLMMessage } from "./llm/router";
import { agentTools } from "./tools/definitions";
import { executeCodeInSandbox } from "./modal/client";

export const inngest = new Inngest({ id: "klaw" });

export const handleAgentTask = inngest.createFunction(
  {
    id: "agent-handle-task",
    retries: 3,
  },
  { event: "task/received" },
  async ({ event, step, logger }) => {
    const { threadId, message, triggerSource } = event.data;

    // 1. Load System Prompt
    const systemPrompt = await step.run("load-context", async () => {
      logger.info(`Loading context for thread ${threadId} (source: ${triggerSource})`);
      return `You are an expert AI engineer assistant for Klaw. You have access to a tool called 'execute_code' which runs Python 3.11 in a secure sandbox with pandas, requests, and matplotlib installed. Use it for any calculations, data analysis, or file generation.`;
    });

    // 2. Initialize messages
    const messages: LLMMessage[] = [{ role: "user", content: message }];

    let iterations = 0;
    let done = false;

    // 3. The Durable Agent Loop
    while (!done && iterations < 10) {
      iterations++;

      // THINK: Call LLM with tools available
      // callLLM returns the assistant message directly: { role, content, tool_calls? }
      const llmResponse = await step.run(`think-${iterations}`, async () => {
        logger.info(`Iteration ${iterations}: Calling LLM...`);
        return await callLLM("kimi-k3", systemPrompt, messages, agentTools);
      });

      // CHECK FOR TOOL CALLS
      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        // Add the assistant's request to use a tool to the message history
        messages.push(llmResponse);

        // ACT: Execute each tool call
        for (const tc of llmResponse.tool_calls) {
          const toolName = tc.function.name as string;
          const toolArgs = JSON.parse(tc.function.arguments || "{}");

          const toolResult = await step.run(
            `tool-${toolName}-${iterations}-${tc.id}`,
            async () => {
              logger.info(`Executing tool: ${toolName}`);

              if (toolName === "execute_code") {
                // Call Modal Sandbox client (lives in @klaw/core — not apps/web)
                const result = await executeCodeInSandbox(toolArgs.code);
                return result.stderr
                  ? `Error: ${result.stderr}`
                  : `Success: ${result.stdout}`;
              }

              return `Error: Unknown tool ${toolName}`;
            }
          );

          // OBSERVE: Feed tool result back so the next THINK can use it
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        // Loop continues — LLM will process the tool result in the next iteration
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
