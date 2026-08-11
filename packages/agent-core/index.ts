import { Inngest } from "inngest";
import { callLLM, LLMMessage } from "./llm/router";
import { agentTools } from "./tools/definitions";
import { executeCodeInSandbox } from "./modal/client";
import { ensureThreadExists, loadHistory, saveMessage } from "./memory";
import { getSlack } from "./clients";

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

    // 2. Load system prompt + prior history (history includes the user msg we just saved)
    const systemPrompt = await step.run("load-context", async () => {
      return `You are an expert AI engineer assistant for Klaw. You have access to a tool called 'execute_code' which runs Python 3.11 in a secure 32GB Modal sandbox. Libraries are preinstalled globally (numpy, pandas, polars, duckdb, scipy, scikit-learn, matplotlib, seaborn, plotly, python-docx, python-pptx, openpyxl, reportlab, PyMuPDF, pdfplumber, Pillow, opencv, pytesseract, requests, httpx, beautifulsoup4, sympy, and more) — never pip install. Write files to the working directory; they are returned. Use the tool for calculations, data analysis, document generation, plotting, or scraping.`;
    });

    const history = await step.run("load-history", async () => {
      return await loadHistory(dbThreadId);
    });

    // History already contains the latest user message — do not duplicate
    const messages: LLMMessage[] = [...history];

    let iterations = 0;
    let done = false;
    let finalResponseText = "";

    // 3. Durable agent loop (Think -> Act -> Observe)
    while (!done && iterations < 10) {
      iterations++;

      const llmResponse = await step.run(`think-${iterations}`, async () => {
        logger.info(`Iteration ${iterations}: Calling LLM...`);
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
                const errPart = result.stderr ? `\nstderr: ${result.stderr}` : "";
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
          `Posting reply to Slack channel=${channel} thread_ts=${slackThreadTs}`
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
    };
  }
);

export { callLLM } from "./llm/router";
export type { LLMMessage } from "./llm/router";
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
