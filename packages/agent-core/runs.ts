/**
 * Persist agent_runs lifecycle for the dashboard / observability.
 */

import { getSupabase } from "./clients";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type AgentRunStep = {
  name: string;
  status: string;
  at: string;
  detail?: string;
};

export async function startAgentRun(input: {
  threadId: string;
  trigger: string;
}): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("agent_runs")
      .insert({
        thread_id: input.threadId,
        trigger: input.trigger,
        status: "running",
        steps: [],
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("startAgentRun:", error?.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.error("startAgentRun error:", e);
    return null;
  }
}

export async function appendAgentRunStep(
  runId: string | null,
  step: AgentRunStep
): Promise<void> {
  if (!runId) return;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("agent_runs")
      .select("steps")
      .eq("id", runId)
      .maybeSingle();
    const prev = Array.isArray(data?.steps) ? data!.steps : [];
    const next = [...prev, step];
    await supabase
      .from("agent_runs")
      .update({ steps: next })
      .eq("id", runId);
  } catch (e) {
    console.error("appendAgentRunStep error:", e);
  }
}

export async function finishAgentRun(
  runId: string | null,
  status: AgentRunStatus,
  finalStep?: AgentRunStep
): Promise<void> {
  if (!runId) return;
  try {
    if (finalStep) await appendAgentRunStep(runId, finalStep);
    await getSupabase()
      .from("agent_runs")
      .update({ status })
      .eq("id", runId);
  } catch (e) {
    console.error("finishAgentRun error:", e);
  }
}
