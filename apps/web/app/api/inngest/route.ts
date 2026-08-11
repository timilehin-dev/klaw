import { serve } from "inngest/next";
import { inngest, handleAgentTask } from "@klaw/core";

// Serves the agent brain functions to the Inngest Dev Server / Cloud
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    handleAgentTask,
  ],
});
