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
  loadMemoryContext,
  loadRelevantMemories,
  createMemoryEntity,
  addObservation,
  createMemoryRelation,
  searchMemory,
  createScheduledTask,
  listScheduledTasks,
} from "./memory";
import { getSlack, getSupabase } from "./clients";
import { getWorkspaceSlackClient } from "./workspace-tokens";
import { createCronDispatcher } from "./cron";
import { appendAgentLog } from "./logging";
import { requiresHumanApproval } from "./guardrails";
import {
  callMcpTool,
  describeFreeMcpRegistry,
  listMcpTools,
} from "./mcp/bridge";
import { persistSandboxArtifacts } from "./artifacts-persist";
import {
  appendAgentRunStep,
  finishAgentRun,
  startAgentRun,
} from "./runs";
import {
  buildBaseSystemPrompt,
  loadSkillPrompts,
  prefersReasoningModel,
} from "./skills/registry";

export const inngest = new Inngest({ id: "klaw" });
export const handleScheduledTasks = createCronDispatcher(inngest);

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
      workspaceKey ||
      (triggerSource === "web"
        ? "web"
        : triggerSource === "cron"
          ? workspaceKey || "default"
          : "default");

    // 1. Schema-safe memory
    const dbThreadId = await step.run("init-memory", async () => {
      let id: string;
      if (triggerSource === "web") {
        id = threadId as string;
      } else {
        // slack + cron: map external/synthetic thread keys → internal UUID
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
      const memoryContext = await loadMemoryContext(workspace);
      const relevantMemories = await loadRelevantMemories(workspace, message);
      const prompt =
        buildBaseSystemPrompt() +
        skillsContext +
        constraintsContext +
        memoryContext +
        relevantMemories +
        "\n\nIMPORTANT: Prefer preinstalled sandbox libraries. Only pass `dependencies` for rare packages not already available. Save all files under `/mnt/data`. Set requires_approval=true for destructive actions. Use web_search (Tavily) for research; browser tools for interactive sites. Use mcp_list_servers / mcp_list_tools / mcp_call_tool for free public MCP tools (start with server_id=time). When you learn durable facts, USE create_memory. When asked about past facts, USE search_memory first. Use schedule_task for recurring proactive work (UTC cron).";
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

    const runId = await step.run("start-agent-run", async () => {
      return await startAgentRun({
        threadId: dbThreadId,
        trigger: triggerSource || "unknown",
      });
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

          // --- FREE PUBLIC MCP ---
          if (toolName === "mcp_list_servers") {
            const out = await step.run(`mcp-list-servers-${tc.id}`, async () => {
              await appendAgentLog(dbThreadId, "mcp_list_servers", "completed");
              await appendAgentRunStep(runId, {
                name: "mcp_list_servers",
                status: "completed",
                at: new Date().toISOString(),
              });
              return describeFreeMcpRegistry();
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (toolName === "mcp_list_tools") {
            const out = await step.run(`mcp-list-tools-${tc.id}`, async () => {
              const serverId = String(toolArgs.server_id || "");
              const listed = await listMcpTools(serverId);
              await appendAgentLog(
                dbThreadId,
                "mcp_list_tools",
                listed.success ? "completed" : "failed",
                serverId
              );
              await appendAgentRunStep(runId, {
                name: `mcp_list_tools:${serverId}`,
                status: listed.success ? "completed" : "failed",
                at: new Date().toISOString(),
                detail: listed.error,
              });
              if (!listed.success) {
                return `Failed to list tools: ${listed.error}`;
              }
              return listed.tools
                .map(
                  (t) =>
                    `- ${t.name}: ${t.description}\n  schema: ${JSON.stringify(t.inputSchema)}`
                )
                .join("\n");
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (toolName === "mcp_call_tool") {
            const out = await step.run(`mcp-call-${tc.id}`, async () => {
              const serverId = String(toolArgs.server_id || "");
              const name = String(toolArgs.tool_name || "");
              const args =
                toolArgs.arguments && typeof toolArgs.arguments === "object"
                  ? (toolArgs.arguments as Record<string, unknown>)
                  : {};
              const result = await callMcpTool(serverId, name, args, {
                workspaceId: workspace,
              });
              await appendAgentLog(
                dbThreadId,
                "mcp_call_tool",
                result.success ? "completed" : "failed",
                `${serverId}.${name}`
              );
              await appendAgentRunStep(runId, {
                name: `mcp_call:${serverId}.${name}`,
                status: result.success ? "completed" : "failed",
                at: new Date().toISOString(),
                detail: result.error,
              });
              return result.success
                ? result.text
                : `MCP call failed: ${result.error}`;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          // --- MEMORY GRAPH (create_memory / search_memory + aliases) ---
          if (
            toolName === "create_memory" ||
            toolName === "memory_create_entity"
          ) {
            const name = String(
              toolArgs.entity_name || toolArgs.name || ""
            );
            const entityType = String(
              toolArgs.entity_type || "concept"
            );
            const observations = Array.isArray(toolArgs.observations)
              ? toolArgs.observations.map(String)
              : [];
            const out = await step.run(`memory-entity-${tc.id}`, async () => {
              await createMemoryEntity(
                workspace,
                name,
                entityType,
                observations
              );
              await appendAgentLog(
                dbThreadId,
                "create_memory",
                "completed",
                name
              );
              return `Memory stored: ${name} (${entityType})`;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (toolName === "memory_add_observation") {
            const out = await step.run(`memory-obs-${tc.id}`, async () => {
              await addObservation(
                workspace,
                String(toolArgs.entity_name),
                String(toolArgs.observation)
              );
              await appendAgentLog(
                dbThreadId,
                "memory_add_observation",
                "completed",
                toolArgs.entity_name
              );
              return `Observation added to ${toolArgs.entity_name}`;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (toolName === "memory_create_relation") {
            const out = await step.run(`memory-rel-${tc.id}`, async () => {
              await createMemoryRelation(
                workspace,
                String(toolArgs.source_entity),
                String(toolArgs.target_entity),
                String(toolArgs.relation_type)
              );
              await appendAgentLog(
                dbThreadId,
                "memory_create_relation",
                "completed"
              );
              return `Relation saved: ${toolArgs.source_entity} —[${toolArgs.relation_type}]→ ${toolArgs.target_entity}`;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (
            toolName === "search_memory" ||
            toolName === "memory_search"
          ) {
            const out = await step.run(`memory-search-${tc.id}`, async () => {
              const r = await searchMemory(
                workspace,
                String(toolArgs.query || "")
              );
              await appendAgentLog(
                dbThreadId,
                "search_memory",
                "completed",
                toolArgs.query
              );
              return r;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          // --- SCHEDULED TASKS ---
          if (toolName === "schedule_task") {
            const out = await step.run(`schedule-task-${tc.id}`, async () => {
              const created = await createScheduledTask({
                workspaceId: workspace,
                name: String(toolArgs.name),
                cronExpression: String(toolArgs.cron_expression),
                prompt: String(toolArgs.prompt),
                slackChannel: toolArgs.slack_channel
                  ? String(toolArgs.slack_channel)
                  : undefined,
              });
              await appendAgentLog(
                dbThreadId,
                "schedule_task",
                "completed",
                created.id
              );
              return `Scheduled task created: ${toolArgs.name} (id=${created.id}, cron=${toolArgs.cron_expression} UTC)`;
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
            });
            continue;
          }

          if (toolName === "list_scheduled_tasks") {
            const out = await step.run(`list-schedules-${tc.id}`, async () => {
              const tasks = await listScheduledTasks(workspace);
              await appendAgentLog(
                dbThreadId,
                "list_scheduled_tasks",
                "completed",
                `${tasks.length} tasks`
              );
              if (tasks.length === 0) return "No scheduled tasks.";
              return tasks
                .map(
                  (t) =>
                    `- ${t.name} [${t.active ? "active" : "off"}] cron=${t.cron_expression} last=${t.last_run_at || "never"}\n  prompt: ${t.prompt.slice(0, 120)}`
                )
                .join("\n");
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: out,
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
          // Supports script names browser_navigate / browser_click and unified browser_action
          if (
            toolName === "browser_action" ||
            toolName === "browser_navigate" ||
            toolName === "browser_click" ||
            toolName === "browser_type"
          ) {
            const action =
              toolName === "browser_navigate"
                ? "navigate"
                : toolName === "browser_click"
                  ? "click"
                  : toolName === "browser_type"
                    ? "type"
                    : (toolArgs.action as string) || "navigate";

            const browserResult = await step.run(
              `browser-${iterations}-${tc.id}`,
              async () => {
                await appendAgentLog(
                  dbThreadId,
                  `browser_${action}`,
                  "running"
                );
                const r = await runBrowserAction({
                  action: action as any,
                  url: toolArgs.url,
                  selector: toolArgs.selector,
                  text: toolArgs.text,
                  wait_ms: toolArgs.wait_ms,
                });
                await appendAgentLog(
                  dbThreadId,
                  `browser_${action}`,
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

                const approvalClient =
                  (await getWorkspaceSlackClient(workspace)) || getSlack();
                await approvalClient.chat.postMessage({
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
              // Persist sandbox files into Cabinet artifacts
              if (execResult.files && execResult.files.length > 0) {
                await step.run(
                  `persist-artifacts-${iterations}-a${fixAttempts}-${tc.id}`,
                  async () => {
                    const n = await persistSandboxArtifacts(
                      dbThreadId,
                      execResult.files,
                      { source: "execute_code", attempt: fixAttempts }
                    );
                    await appendAgentLog(
                      dbThreadId,
                      "persist-artifacts",
                      "completed",
                      `${n} file(s)`
                    );
                    await appendAgentRunStep(runId, {
                      name: "persist-artifacts",
                      status: "completed",
                      at: new Date().toISOString(),
                      detail: `${n} file(s)`,
                    });
                    return n;
                  }
                );
              }
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

    const replyChannel =
      channel || process.env.DEFAULT_SLACK_CHANNEL || null;

    if (
      (triggerSource === "slack" || triggerSource === "cron") &&
      replyChannel
    ) {
      await step.run("reply-slack", async () => {
        logger.info(
          `Slack reply channel=${replyChannel} thread_ts=${slackThreadTs || "n/a"} model=${modelUsed} source=${triggerSource}`
        );
        const client =
          (await getWorkspaceSlackClient(workspace)) || getSlack();
        await client.chat.postMessage({
          channel: replyChannel,
          ...(triggerSource === "slack" && slackThreadTs
            ? { thread_ts: slackThreadTs }
            : {}),
          text: finalResponseText,
        });
        await appendAgentLog(dbThreadId, "reply-slack", "completed");
      });
    } else if (triggerSource === "web") {
      await step.run("reply-web", async () => {
        await appendAgentLog(dbThreadId, "reply-web", "completed", "poll UI");
      });
    }

    await step.run("finish-agent-run", async () => {
      await finishAgentRun(runId, "completed", {
        name: "finish",
        status: "completed",
        at: new Date().toISOString(),
        detail: `model=${modelUsed}; iterations=${iterations}`,
      });
    });

    return {
      success: true,
      response: finalResponseText,
      iterations,
      dbThreadId,
      model: modelUsed,
      runId,
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
export { runBrowserAction, executeBrowserAction } from "./tools/browser";
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
  loadMemoryContext,
  loadRelevantMemories,
  createMemoryEntity,
  addObservation,
  createMemoryRelation,
  searchMemory,
  createScheduledTask,
  listScheduledTasks,
  deactivateScheduledTask,
} from "./memory";
export { getSupabase, getSlack, supabase, slack } from "./clients";
export {
  getWorkspaceBotToken,
  getWorkspaceSlackClient,
} from "./workspace-tokens";
export { cronMatches, createCronDispatcher } from "./cron";
export { appendAgentLog } from "./logging";
export type { AgentLogStatus } from "./logging";
export { requiresHumanApproval, codeLooksDestructive } from "./guardrails";
export {
  callMcpTool,
  listMcpTools,
  describeFreeMcpRegistry,
} from "./mcp/bridge";
export {
  MCP_REGISTRY,
  FREE_MCP_REGISTRY,
  getMcpServer,
  listMcpServers,
  listFreeMcpServers,
  listZeroKeyMcpServers,
  listReadyMcpServers,
} from "./mcp/registry";
export {
  mapSandboxFilesToArtifacts,
  inferArtifactType,
  buildDurableFilePath,
} from "./artifacts";
export { persistSandboxArtifacts } from "./artifacts-persist";
export { verifySlackSignature, signSlackRequest } from "./slack/verify";
export {
  startAgentRun,
  appendAgentRunStep,
  finishAgentRun,
} from "./runs";
export {
  loadSkillPrompts,
  listSkills,
  prefersReasoningModel,
  buildBaseSystemPrompt,
} from "./skills/registry";
export { SKILL_CATALOG } from "./skills/catalog";
export type { SkillId, SkillDefinition } from "./skills/catalog";
