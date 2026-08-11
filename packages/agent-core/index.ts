import { Inngest } from "inngest";
import {
  callLLM,
  fixCodeWithDeepSeek,
  LLMMessage,
  selectModel,
  type ModelId,
} from "./llm/router";
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

const MAX_SELF_HEAL_FIXES = 2;

function formatExecResult(result: {
  success: boolean;
  stdout: string;
  stderr: string;
  files?: { path: string; size: number; media_type?: string }[];
  duration_ms?: number;
  error_type?: string | null;
}): string {
  const fileSummary =
    result.files && result.files.length > 0
      ? `\nFiles written: ${result.files
          .map((f) => `${f.path} (${f.size} bytes, ${f.media_type || "unknown"})`)
          .join(", ")}`
      : "";
  const timing =
    result.duration_ms != null ? `\nDuration: ${result.duration_ms}ms` : "";

  if (!result.success) {
    return `Error: ${result.stderr || result.error_type || "execution failed"}\nstdout: ${result.stdout || ""}${fileSummary}${timing}`;
  }
  const errPart = result.stderr ? `\nstderr: ${result.stderr}` : "";
  return `Success:\n${result.stdout || "(no stdout)"}${errPart}${fileSummary}${timing}`;
}

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

    const slackThreadTs: string = threadId;
    const workspace = workspaceKey || "default";

    // 1. Schema-safe memory (internal UUID thread id)
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

    // 2. Base prompt + 8 skills (+ dependency guidance)
    const systemPrompt = await step.run("load-context", async () => {
      return (
        buildBaseSystemPrompt() +
        loadSkillPrompts() +
        "\n\nIMPORTANT: Prefer preinstalled sandbox libraries. Only pass `dependencies` for rare packages not already available. Save all files under `/mnt/data`."
      );
    });

    const history = await step.run("load-history", async () => {
      return await loadHistory(dbThreadId);
    });

    const messages: LLMMessage[] = [...history];

    // Dual-model entry: pure reasoning → DeepSeek; else Kimi agentic loop
    const useReasoning = prefersReasoningModel(message);
    let iterations = 0;
    let done = false;
    let finalResponseText = "";
    let modelUsed: ModelId = selectModel(
      useReasoning ? "reasoning" : "agentic"
    );

    if (useReasoning) {
      const llmResponse = await step.run("think-reasoning", async () => {
        logger.info("DeepSeek V4 Pro reasoning-only path...");
        return await callLLM("deepseek-v4-pro", systemPrompt, messages);
      });

      if (llmResponse.content) {
        done = true;
        finalResponseText = llmResponse.content;
        modelUsed = "deepseek-v4-pro";
        iterations = 1;
        await step.run("save-response", async () => {
          await saveMessage(dbThreadId, "assistant", finalResponseText);
        });
      } else {
        logger.warn("DeepSeek empty; falling back to Kimi agentic loop");
      }
    }

    // 3. Kimi plans/tools; DeepSeek self-heals failing execute_code
    while (!done && iterations < 10) {
      iterations++;
      modelUsed = "kimi-k3";

      const llmResponse = await step.run(`think-kimi-${iterations}`, async () => {
        logger.info(`Iteration ${iterations}: Kimi K3 thinking...`);
        return await callLLM("kimi-k3", systemPrompt, messages, agentTools);
      });

      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        messages.push(llmResponse);

        for (const tc of llmResponse.tool_calls) {
          const toolName = tc.function?.name as string;
          let toolArgs: { code?: string; dependencies?: string[] } = {};
          try {
            toolArgs = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Error: invalid tool arguments JSON",
            });
            continue;
          }

          if (toolName !== "execute_code") {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Tool not found.",
            });
            continue;
          }

          let codeToRun = toolArgs.code || "";
          const dependencies = Array.isArray(toolArgs.dependencies)
            ? toolArgs.dependencies
            : [];
          let toolResultStr = "";
          let success = false;
          let fixAttempts = 0;

          // ACT + SELF-HEAL (DeepSeek) up to MAX_SELF_HEAL_FIXES
          while (!success && fixAttempts <= MAX_SELF_HEAL_FIXES) {
            const execResult = await step.run(
              `execute-code-${iterations}-a${fixAttempts}-${tc.id}`,
              async () => {
                logger.info(
                  `Modal execute attempt ${fixAttempts + 1}; deps=[${dependencies.join(", ")}]`
                );
                return await executeCodeInSandbox(codeToRun, { dependencies });
              }
            );

            if (execResult.success) {
              success = true;
              toolResultStr = formatExecResult(execResult);
            } else if (fixAttempts < MAX_SELF_HEAL_FIXES) {
              logger.info(
                `Code failed: ${execResult.stderr}. Asking DeepSeek to fix...`
              );
              codeToRun = await step.run(
                `fix-code-deepseek-${iterations}-a${fixAttempts}-${tc.id}`,
                async () => {
                  return await fixCodeWithDeepSeek(
                    codeToRun,
                    execResult.stderr || "Unknown error"
                  );
                }
              );
              fixAttempts++;
            } else {
              toolResultStr = `Failed after ${MAX_SELF_HEAL_FIXES + 1} attempts. Last error:\n${formatExecResult(execResult)}`;
              fixAttempts++;
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResultStr || "Error: empty tool result",
          });
        }
      } else if (llmResponse.content) {
        done = true;
        finalResponseText = llmResponse.content;
        await step.run("save-response", async () => {
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

    // 4. Slack threaded reply
    if (triggerSource === "slack" && channel) {
      await step.run("reply-slack", async () => {
        logger.info(
          `Slack reply channel=${channel} thread_ts=${slackThreadTs} model=${modelUsed}`
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

export { callLLM, fixCodeWithDeepSeek, selectModel } from "./llm/router";
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
