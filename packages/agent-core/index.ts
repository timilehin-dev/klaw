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
import { tavilySearch } from "./tools/tavily";
import { runBrowserAction } from "./tools/browser";
import {
  ensureThreadExists,
  loadHistory,
  saveMessage,
  loadConstraints,
} from "./memory";
import { getSlack, getSupabase } from "./clients";
import { appendAgentLog } from "./logging";
import { requiresHumanApproval } from "./guardrails";
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

    const slackThreadTs: string | null =
      triggerSource === "slack" ? threadId : null;
    const workspace =
      workspaceKey || (triggerSource === "web" ? "web" : "default");

    // 1. Schema-safe memory
    const dbThreadId = await step.run("init-memory", async () => {
      let id: string;
      if (triggerSource === "web") {
        id = threadId as string;
      } else {
        id = await ensureThreadExists(threadId, workspace, channel || "");
      }
      await saveMessage(id, "user", message);
      await appendAgentLog(id, "task/received", "completed", triggerSource);
      logger.info(
        `Memory ready thread_db=${id} source=${triggerSource} user=${user || "n/a"}`
      );
      return id;
    });

    // 2. Base prompt + skills + workspace guardrails
    const systemPrompt = await step.run("load-context", async () => {
      const skillsContext = loadSkillPrompts();
      const constraintsContext = await loadConstraints(workspace);
      const prompt =
        buildBaseSystemPrompt() +
        skillsContext +
        constraintsContext +
        "\n\nIMPORTANT: Prefer preinstalled sandbox libraries. Only pass `dependencies` for rare packages not already available. Save all files under `/mnt/data`. Set requires_approval=true for destructive actions. Use web_search (Tavily) for research; use browser_action for interactive/JS sites.";
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

    // 3. Agentic loop with HITL + self-heal
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
          let toolArgs: Record<string, any> = {};
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

          // --- WEB SEARCH (Tavily) ---
          if (toolName === "web_search") {
            const searchResult = await step.run(
              `web-search-${iterations}-${tc.id}`,
              async () => {
                await appendAgentLog(dbThreadId, "web_search", "running");
                const r = await tavilySearch(String(toolArgs.query || ""), {
                  maxResults: Number(toolArgs.max_results) || 5,
                });
                await appendAgentLog(
                  dbThreadId,
                  "web_search",
                  r.success ? "completed" : "failed",
                  r.success ? undefined : r.error
                );
                return r;
              }
            );
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: searchResult.success
                ? searchResult.summary
                : `Search failed: ${searchResult.error}`,
            });
            continue;
          }

          // --- BROWSER (Playwright Modal) ---
          if (toolName === "browser_action") {
            const browserResult = await step.run(
              `browser-${iterations}-${tc.id}`,
              async () => {
                await appendAgentLog(
                  dbThreadId,
                  `browser_${toolArgs.action || "action"}`,
                  "running"
                );
                const r = await runBrowserAction({
                  action: toolArgs.action,
                  url: toolArgs.url,
                  selector: toolArgs.selector,
                  text: toolArgs.text,
                  wait_ms: toolArgs.wait_ms,
                });
                await appendAgentLog(
                  dbThreadId,
                  `browser_${toolArgs.action || "action"}`,
                  r.success ? "completed" : "failed",
                  r.success ? r.title || r.url : r.error
                );
                return r;
              }
            );
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: browserResult.success
                ? `URL: ${browserResult.url || toolArgs.url}\nTitle: ${browserResult.title || ""}\n\n${browserResult.content || ""}${
                    browserResult.screenshot_base64
                      ? "\n[screenshot captured — base64 omitted from chat]"
                      : ""
                  }`
                : `Browser action failed: ${browserResult.error}`,
            });
            continue;
          }

          // --- CODE EXECUTION ---
          if (toolName !== "execute_code") {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Tool not found.",
            });
            continue;
          }

          let codeToRun = String(toolArgs.code || "");
          const dependencies = Array.isArray(toolArgs.dependencies)
            ? toolArgs.dependencies
            : [];

          // --- HUMAN-IN-THE-LOOP ---
          const needsApproval = requiresHumanApproval(
            codeToRun,
            toolArgs.requires_approval
          );

          if (needsApproval) {
            await step.run(`request-approval-${tc.id}`, async () => {
              await appendAgentLog(
                dbThreadId,
                "request-approval",
                "running",
                tc.id
              );
              await getSupabase().from("approvals").insert({
                thread_id: dbThreadId,
                tool_call_id: tc.id,
                code_preview: codeToRun.slice(0, 2000),
                status: "pending",
              });

              if (triggerSource === "slack" && channel && slackThreadTs) {
                const preview = codeToRun.slice(0, 500);
                const valueApprove = JSON.stringify({
                  toolCallId: tc.id,
                  threadId: dbThreadId,
                  decision: "approved",
                });
                const valueDeny = JSON.stringify({
                  toolCallId: tc.id,
                  threadId: dbThreadId,
                  decision: "denied",
                });

                await getSlack().chat.postMessage({
                  channel,
                  thread_ts: slackThreadTs,
                  text: "⚠️ Approval required for agent code execution",
                  blocks: [
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: `⚠️ *Action requires approval:*\n\`\`\`python\n${preview}\n\`\`\``,
                      },
                    },
                    {
                      type: "actions",
                      elements: [
                        {
                          type: "button",
                          text: { type: "plain_text", text: "Approve" },
                          style: "primary",
                          action_id: "approve_code",
                          value: valueApprove,
                        },
                        {
                          type: "button",
                          text: { type: "plain_text", text: "Deny" },
                          style: "danger",
                          action_id: "deny_code",
                          value: valueDeny,
                        },
                      ],
                    },
                  ],
                });
              }

              await appendAgentLog(
                dbThreadId,
                "request-approval",
                "completed",
                triggerSource === "web"
                  ? "pending web approval"
                  : "pending slack approval"
              );
            });

            const approvalEvent = await step.waitForEvent(
              `wait-approval-${tc.id}`,
              {
                event: "approval/resolved",
                timeout: "24h",
                if: `async.data.toolCallId == "${tc.id}"`,
              }
            );

            const approved = Boolean(
              approvalEvent && (approvalEvent as any).data?.approved
            );

            if (!approved) {
              logger.info(`Approval denied or timed out for ${tc.id}`);
              await appendAgentLog(
                dbThreadId,
                "approval-denied",
                "failed",
                tc.id
              );
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content:
                  "User denied this action (or approval timed out). Do not attempt the same destructive action again without asking.",
              });
              continue;
            }

            await appendAgentLog(
              dbThreadId,
              "approval-granted",
              "completed",
              tc.id
            );
          }

          // --- EXECUTION + SELF-HEAL ---
          let toolResultStr = "";
          let success = false;
          let fixAttempts = 0;

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
export { tavilySearch } from "./tools/tavily";
export type { TavilyResult } from "./tools/tavily";
export { runBrowserAction } from "./tools/browser";
export type {
  BrowserActionInput,
  BrowserActionResult,
  BrowserAction,
} from "./tools/browser";
export {
  ensureWorkspace,
  ensureThreadExists,
  loadHistory,
  saveMessage,
  loadConstraints,
} from "./memory";
export { getSupabase, getSlack, supabase, slack } from "./clients";
export { appendAgentLog } from "./logging";
export type { AgentLogStatus } from "./logging";
export { requiresHumanApproval, codeLooksDestructive } from "./guardrails";
export {
  loadSkillPrompts,
  listSkills,
  prefersReasoningModel,
  buildBaseSystemPrompt,
} from "./skills/registry";
export { SKILL_CATALOG } from "./skills/catalog";
export type { SkillId, SkillDefinition } from "./skills/catalog";
