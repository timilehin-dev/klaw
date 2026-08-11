import { getSupabase } from "./clients";

export type AgentLogStatus = "running" | "completed" | "failed";

/** Append a timeline step for the dashboard live view */
export async function appendAgentLog(
  dbThreadId: string,
  stepName: string,
  status: AgentLogStatus = "completed",
  detail?: string
): Promise<void> {
  try {
    const { error } = await getSupabase().from("agent_logs").insert({
      thread_id: dbThreadId,
      step_name: stepName,
      status,
      detail: detail || null,
    });
    if (error) {
      console.error("appendAgentLog failed:", error.message);
    }
  } catch (e) {
    console.error("appendAgentLog error:", e);
  }
}
