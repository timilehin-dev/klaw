import { Inngest } from "inngest";
import { getSupabase } from "./clients";
import { getWorkspaceSlackClient } from "./workspace-tokens";

/**
 * Minimal cron matcher for common 5-field expressions.
 * Supports: "*", ranges (1-5), lists (1,3,5), steps (*/5), and numbers.
 * Not a full cron engine — good enough for agentic schedules.
 */
function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (!step) continue;
      if (range === "*" || range === "") {
        if (value % step === 0) return true;
      } else if (range.includes("-")) {
        const [a, b] = range.split("-").map(Number);
        if (value >= a && value <= b && (value - a) % step === 0) return true;
      }
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else if (parseInt(part, 10) === value) {
      return true;
    }
  }
  return false;
}

/** Returns true if cron expression matches the given UTC date (minute precision). */
export function cronMatches(expression: string, date: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const d = {
    min: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    dom: date.getUTCDate(),
    mon: date.getUTCMonth() + 1,
    dow: date.getUTCDay(), // 0=Sun
  };
  return (
    fieldMatches(min, d.min) &&
    fieldMatches(hour, d.hour) &&
    fieldMatches(dom, d.dom) &&
    fieldMatches(mon, d.mon) &&
    fieldMatches(dow, d.dow)
  );
}

/**
 * Register on the shared Inngest app from index.ts by importing this factory.
 * Runs every 5 minutes and dispatches due scheduled_tasks as task/received events.
 */
export function createCronDispatcher(inngest: Inngest) {
  return inngest.createFunction(
    {
      id: "scheduled-tasks-dispatcher",
      retries: 1,
    },
    { cron: "*/5 * * * *" },
    async ({ step, logger }) => {
      const due = await step.run("find-due-tasks", async () => {
        const now = new Date();
        const { data, error } = await getSupabase()
          .from("scheduled_tasks")
          .select("*")
          .eq("active", true);

        if (error) throw new Error(error.message);

        const tasks = (data || []).filter((t) => {
          // Avoid double-fire within the same 5-min window
          if (t.last_run_at) {
            const last = new Date(t.last_run_at).getTime();
            if (now.getTime() - last < 4 * 60 * 1000) return false;
          }
          return cronMatches(t.cron_expression, now);
        });

        return tasks;
      });

      logger.info(`Cron dispatcher: ${due.length} due task(s)`);

      for (const task of due) {
        await step.run(`dispatch-${task.id}`, async () => {
          await inngest.send({
            name: "task/received",
            data: {
              // Synthetic thread id for cron runs
              threadId: `cron-${task.id}-${Date.now()}`,
              message: task.prompt,
              triggerSource: "cron",
              channel: task.slack_channel || null,
              user: "system-cron",
              workspaceId: task.workspace_id,
              scheduledTaskId: task.id,
              scheduledTaskName: task.name,
            },
          });

          await getSupabase()
            .from("scheduled_tasks")
            .update({ last_run_at: new Date().toISOString() })
            .eq("id", task.id);

          // Optional: post a notice to Slack that the run started
          if (task.slack_channel) {
            try {
              const client = await getWorkspaceSlackClient(task.workspace_id);
              if (client) {
                await client.chat.postMessage({
                  channel: task.slack_channel,
                  text: `⏰ Scheduled task started: *${task.name}*`,
                });
              }
            } catch {
              // ignore slack notify errors
            }
          }
        });
      }

      return { dispatched: due.length };
    }
  );
}
