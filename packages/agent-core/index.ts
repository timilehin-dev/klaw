import { Inngest } from "inngest";
import { callLLM, LLMMessage, selectModel, type ModelId } from "./llm/router";
import { agentTools } from "./tools/definitions";
import { executeCodeInSandbox } from "./modal/client";
import { ensureThreadExists, loadHistory, saveMessage } from "./memory";
import { getSlack } from "./clients";
import {
  buildBaseSystemPrompt,
  loadSkillPrompts,
  prefersReasoningModel,
} from "./skills/registry";

export const inngest = new Inngest({ id: "klaw" });

export const handleAgentTask = inngest.createFunction(
  {
    id: "agent-handle-task",
    retries: 3,
  },
  { event: "task/received" },
  async ({ event, step, logger }) => {
    const {
      threadId,
      message,
      triggerSource,
      channel,
      user,
      workspaceId: workspaceKey,
    } = event.data;

    // Slack thread_ts (or message ts). Internal DB id is resolved below.
    const slackThreadTs: string = threadId;
    const workspace = workspaceKey || "default";

    // 1. Initialize thread in Supabase & save the inbound user message
    const dbThreadId = await step.run("init-memory", async () => {
      const id = await ensureThreadExists(
        slackThreadTs,
        workspace,
        channel || ""
      );
      await saveMessage(id, "user", message);
      logger.info(
        `Memory ready thread_db=${id} slack_ts=${slackThreadTs} user=${user || "n/a"}`
      );
      return id;
    });

    // 2. System prompt = base + 8 industry skills
    const systemPrompt = await step.run("load-context", async () => {
      return buildBaseSystemPrompt() + loadSkillPrompts();
    });

    const history = await step.run("load-history", async () => {
      return await loadHistory(dbThreadId);
    });

    // History already contains the latest user message — do not duplicate
    const messages: LLMMessage[] = [...history];

    // Dual-model: pure reasoning/review → DeepSeek (no tools); else Kimi agentic loop
    const useReasoning = prefersReasoningModel(message);
    const primaryModel: ModelId = selectModel(
      useReasoning ? "reasoning" : "agentic"
    );
    logger.info(
      `Model policy: ${primaryModel} (reasoning=${useReasoning})`
    );

    let iterations = 0;
    let done = false;
    let finalResponseText = "";
    let modelUsed: ModelId = primaryModel;

    // 3a. Reasoning-only path (DeepSeek V4 Pro, no tools)
    if (useReasoning) {
      const llmResponse = await step.run("think-reasoning", async () => {
        logger.info("Calling DeepSeek V4 Pro for reasoning-only path...");
        return await callLLM(
          "deepseek-v4-pro",
          systemPrompt,
          messages
          // no tools
        );
      });

      if (llmResponse.content) {
        done = true;
        finalResponseText = llmResponse.content;
        modelUsed = "deepseek-v4-pro";
        iterations = 1;

        await step.run("save-response", async () => {
          logger.info("Reasoning path finished. Saving response to DB.");
          await saveMessage(dbThreadId, "assistant", finalResponseText);
        });
      } else {
        // Fall through to agentic path if DeepSeek returned empty
        logger.warn("DeepSeek returned empty content; falling back to agentic Kimi loop");
      }
    }

    // 3b. Agentic path (Kimi K3 + tools + skills)
    while (!done && iterations < 10) {
      iterations++;
      modelUsed = "kimi-k3";

      const llmResponse = await step.run(`think-${iterations}`, async () => {
        logger.info(`Iteration ${iterations}: Calling Kimi K3 (agentic)...`);
        return await callLLM("kimi-k3", systemPrompt, messages, agentTools);
      });

      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        messages.push(llmResponse);

        for (const tc of llmResponse.tool_calls) {
          const toolName = tc.function.name as string;
          const toolArgs = JSON.parse(tc.function.arguments || "{}");

          const toolResult = await step.run(
            `tool-${toolName}-${iterations}-${tc.id}`,
            async () => {
              logger.info(`Executing tool: ${toolName}`);

              if (toolName === "execute_code") {
                const result = await executeCodeInSandbox(toolArgs.code);
                const fileSummary =
                  result.files && result.files.length > 0
                    ? `\nFiles written: ${result.files
                        .map(
                          (f) =>
                            `${f.path} (${f.size} bytes, ${f.media_type || "unknown"})`
                        )
                        .join(", ")}`
                    : "";
                const timing =
                  result.duration_ms != null
                    ? `\nDuration: ${result.duration_ms}ms`
                    : "";

                if (!result.success) {
                  return `Error: ${result.stderr || result.error_type || "execution failed"}\nstdout: ${result.stdout || ""}${fileSummary}${timing}`;
                }
                const errPart = result.stderr
                  ? `\nstderr: ${result.stderr}`
                  : "";
                return `Success:\n${result.stdout || "(no stdout)"}${errPart}${fileSummary}${timing}`;
              }

              return "Tool not found.";
            }
          );

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        // Loop continues with tool observations
      } else if (llmResponse.content) {
        done = true;
        finalResponseText = llmResponse.content;

        await step.run("save-response", async () => {
          logger.info("Agent finished. Saving response to DB.");
          await saveMessage(dbThreadId, "assistant", finalResponseText);
        });
      } else {
        done = true;
        finalResponseText =
          "I encountered an issue processing that request.";
        await step.run("save-empty-fallback", async () => {
          await saveMessage(dbThreadId, "assistant", finalResponseText);
        });
      }
    }

    if (!finalResponseText) {
      finalResponseText =
        "I hit the maximum number of reasoning steps without a final answer. Please try a simpler request.";
      await step.run("save-max-iter-fallback", async () => {
        await saveMessage(dbThreadId, "assistant", finalResponseText);
      });
    }

    // 4. Reply to Slack (threaded)
    if (triggerSource === "slack" && channel) {
      await step.run("reply-slack", async () => {
        logger.info(
          `Posting reply to Slack channel=${channel} thread_ts=${slackThreadTs} model=${modelUsed}`
        );
        await getSlack().chat.postMessage({
          channel,
          thread_ts: slackThreadTs,
          text: finalResponseText,
        });
      });
    }

    return {
      success: true,
      response: finalResponseText,
      iterations,
      dbThreadId,
      model: modelUsed,
    };
  }
);

export { callLLM, selectModel } from "./llm/router";
export type { LLMMessage, ModelId } from "./llm/router";
export { agentTools } from "./tools/definitions";
export { executeCodeInSandbox } from "./modal/client";
export type {
  SandboxResult,
  SandboxFile,
  ExecuteCodeOptions,
} from "./modal/client";
export {
  ensureWorkspace,
  ensureThreadExists,
  loadHistory,
  saveMessage,
} from "./memory";
export { getSupabase, getSlack, supabase, slack } from "./clients";
export {
  loadSkillPrompts,
  listSkills,
  prefersReasoningModel,
  buildBaseSystemPrompt,
} from "./skills/registry";
export { SKILL_CATALOG } from "./skills/catalog";
export type { SkillId, SkillDefinition } from "./skills/catalog";
