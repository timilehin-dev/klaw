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
import { appendAgentLog } from "./logging";
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

    // Slack events pass thread_ts; web dashboard passes internal UUID from /api/threads
    const slackThreadTs: string | null =
      triggerSource === "slack" ? threadId : null;
    const workspace = workspaceKey || (triggerSource === "web" ? "web" : "default");

    // 1. Schema-safe memory (internal UUID thread id)
    const dbThreadId = await step.run("init-memory", async () => {
      let id: string;
      if (triggerSource === "web") {
        // Dashboard already created the thread row
        id = threadId as string;
      } else {
        id = await ensureThreadExists(
          threadId,
          workspace,
          channel || ""
        );
      }
      await saveMessage(id, "user", message);
      await appendAgentLog(id, "task/received", "completed", triggerSource);
      logger.info(
        `Memory ready thread_db=${id} source=${triggerSource} user=${user || "n/a"}`
      );
      return id;
    });

    // 2. Base prompt + 8 skills (+ dependency guidance)
    const systemPrompt = await step.run("load-context", async () => {
      const prompt =
        buildBaseSystemPrompt() +
        loadSkillPrompts() +
        "\n\nIMPORTANT: Prefer preinstalled sandbox libraries. Only pass `dependencies` for rare packages not already available. Save all files under `/mnt/data`.";
      await appendAgentLog(dbThreadId, "load-context", "completed");
      return prompt;
    });

    const history = await step.run("load-history", async () => {
      const h = await loadHistory(dbThreadId);
      await appendAgentLog(
        dbThreadId,
        "load-history",
        "completed",
        `${h.length} messages`
      );
      return h;
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
        await appendAgentLog(dbThreadId, "think-deepseek", "running");
        const res = await callLLM("deepseek-v4-pro", systemPrompt, messages);
        await appendAgentLog(dbThreadId, "think-deepseek", "completed");
        return res;
      });

      if (llmResponse.content) {
        done = true;
        finalResponseText = llmResponse.content;
        modelUsed = "deepseek-v4-pro";
        iterations = 1;
        await step.run("save-response", async () => {
          await saveMessage(dbThreadId, "assistant", finalResponseText);
          await appendAgentLog(dbThreadId, "save-response", "completed");
        });
      } else {
        logger.warn("DeepSeek empty; falling back to Kimi agentic loop");
        await appendAgentLog(
          dbThreadId,
          "think-deepseek",
          "failed",
          "empty content; fallback to kimi"
        );
      }
    }

    // 3. Kimi plans/tools; DeepSeek self-heals failing execute_code
    while (!done && iterations < 10) {
      iterations++;
      modelUsed = "kimi-k3";

      const llmResponse = await step.run(`think-kimi-${iterations}`, async () => {
        logger.info(`Iteration ${iterations}: Kimi K3 thinking...`);
        await appendAgentLog(
          dbThreadId,
          `think-kimi-${iterations}`,
          "running"
        );
        const res = await callLLM(
          "kimi-k3",
          systemPrompt,
          messages,
          agentTools
        );
        await appendAgentLog(
          dbThreadId,
          `think-kimi-${iterations}`,
          "completed",
          res.tool_calls?.length
            ? `${res.tool_calls.length} tool call(s)`
            : "final content"
        );
        return res;
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
                await appendAgentLog(
                  dbThreadId,
                  `execute-code-a${fixAttempts}`,
                  "running"
                );
                const r = await executeCodeInSandbox(codeToRun, {
                  dependencies,
                });
                await appendAgentLog(
                  dbThreadId,
                  `execute-code-a${fixAttempts}`,
                  r.success ? "completed" : "failed",
                  r.success ? undefined : r.stderr?.slice(0, 200)
                );
                return r;
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
                  await appendAgentLog(
                    dbThreadId,
                    `fix-deepseek-a${fixAttempts}`,
                    "running"
                  );
                  const fixed = await fixCodeWithDeepSeek(
                    codeToRun,
                    execResult.stderr || "Unknown error"
                  );
                  await appendAgentLog(
                    dbThreadId,
                    `fix-deepseek-a${fixAttempts}`,
                    "completed"
                  );
                  return fixed;
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
          await appendAgentLog(dbThreadId, "save-response", "completed");
        });
      } else {
        done = true;
        finalResponseText =
          "I encountered an issue processing that request.";
        await step.run("save-empty-fallback", async () => {
          await saveMessage(dbThreadId, "assistant", finalResponseText);
          await appendAgentLog(dbThreadId, "save-empty-fallback", "failed");
        });
      }
    }

    if (!finalResponseText) {
      finalResponseText =
        "I hit the maximum number of reasoning steps without a final answer. Please try a simpler request.";
      await step.run("save-max-iter-fallback", async () => {
        await saveMessage(dbThreadId, "assistant", finalResponseText);
        await appendAgentLog(dbThreadId, "max-iterations", "failed");
      });
    }

    // 4. Slack threaded reply (web UI polls Supabase for assistant message)
    if (triggerSource === "slack" && channel && slackThreadTs) {
      await step.run("reply-slack", async () => {
        logger.info(
          `Slack reply channel=${channel} thread_ts=${slackThreadTs} model=${modelUsed}`
        );
        await getSlack().chat.postMessage({
          channel,
          thread_ts: slackThreadTs,
          text: finalResponseText,
        });
        await appendAgentLog(dbThreadId, "reply-slack", "completed");
      });
    } else if (triggerSource === "web") {
      await step.run("reply-web", async () => {
        await appendAgentLog(dbThreadId, "reply-web", "completed", "poll UI");
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
export { appendAgentLog } from "./logging";
export type { AgentLogStatus } from "./logging";
export {
  loadSkillPrompts,
  listSkills,
  prefersReasoningModel,
  buildBaseSystemPrompt,
} from "./skills/registry";
export { SKILL_CATALOG } from "./skills/catalog";
export type { SkillId, SkillDefinition } from "./skills/catalog";
