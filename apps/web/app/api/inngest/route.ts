import { serve } from "inngest/next";
import {
  inngest,
  handleAgentTask,
  handleScheduledTasks,
} from "@klaw/core";

// Serves agent + proactive cron dispatcher to Inngest Dev / Cloud
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [handleAgentTask, handleScheduledTasks],
});
