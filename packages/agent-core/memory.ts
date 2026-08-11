import { getSupabase } from "./clients";
import type { LLMMessage } from "./llm/router";

/**
 * Memory helpers map Slack-facing IDs onto the Supabase schema:
 * - workspaces.id is UUID; external key is slack_team_id (text)
 * - threads.id is UUID; Slack thread_ts is stored in slack_thread_ts
 * - messages.thread_id references threads.id (UUID)
 *
 * The agent event `threadId` is the Slack thread_ts (or message ts).
 */

/** Ensure workspace row exists; return internal UUID */
export async function ensureWorkspace(
  slackTeamId: string,
  slackTeamName?: string
): Promise<string> {
  const supabase = getSupabase();
  const teamId = slackTeamId || "default";

  const { data: existing, error: selectError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slack_team_id", teamId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`ensureWorkspace select failed: ${selectError.message}`);
  }

  if (existing?.id) return existing.id as string;

  const { data: created, error: insertError } = await supabase
    .from("workspaces")
    .insert({
      slack_team_id: teamId,
      slack_team_name: slackTeamName || teamId,
    })
    .select("id")
    .single();

  if (insertError || !created?.id) {
    // Race: another worker may have inserted — re-select
    const { data: raced } = await supabase
      .from("workspaces")
      .select("id")
      .eq("slack_team_id", teamId)
      .maybeSingle();
    if (raced?.id) return raced.id as string;
    throw new Error(
      `ensureWorkspace insert failed: ${insertError?.message || "unknown"}`
    );
  }

  return created.id as string;
}

/**
 * Ensure a thread exists for this Slack conversation.
 * Returns the internal threads.id UUID used by messages.thread_id.
 */
export async function ensureThreadExists(
  slackThreadTs: string,
  workspaceKey: string,
  channel: string
): Promise<string> {
  const supabase = getSupabase();
  const workspaceId = await ensureWorkspace(workspaceKey);

  const { data: existing, error: selectError } = await supabase
    .from("threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slack_thread_ts", slackThreadTs)
    .eq("slack_channel", channel || "")
    .maybeSingle();

  if (selectError) {
    throw new Error(`ensureThreadExists select failed: ${selectError.message}`);
  }

  if (existing?.id) return existing.id as string;

  const { data: created, error: insertError } = await supabase
    .from("threads")
    .insert({
      workspace_id: workspaceId,
      slack_channel: channel || null,
      slack_thread_ts: slackThreadTs,
      status: "active",
    })
    .select("id")
    .single();

  if (insertError || !created?.id) {
    const { data: raced } = await supabase
      .from("threads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("slack_thread_ts", slackThreadTs)
      .eq("slack_channel", channel || "")
      .maybeSingle();
    if (raced?.id) return raced.id as string;
    throw new Error(
      `ensureThreadExists insert failed: ${insertError?.message || "unknown"}`
    );
  }

  return created.id as string;
}

/** Load conversation history for LLM (user + assistant only) */
export async function loadHistory(dbThreadId: string): Promise<LLMMessage[]> {
  const supabase = getSupabase();

  const { data: messages, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", dbThreadId)
    .in("role", ["user", "assistant", "system"])
    .order("created_at", { ascending: true });

  if (error || !messages) return [];

  return messages
    .filter((msg) => msg.content != null && msg.content !== "")
    .map((msg) => ({
      role: msg.role as LLMMessage["role"],
      content: msg.content as string,
    }));
}

/** Persist a message against the internal thread UUID */
export async function saveMessage(
  dbThreadId: string,
  role: string,
  content: string
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("messages").insert({
    thread_id: dbThreadId,
    role,
    content,
  });

  if (error) {
    throw new Error(`saveMessage failed: ${error.message}`);
  }
}

/**
 * Load global guardrails for a workspace key (slack_team_id or "web").
 * Also includes rules tagged workspace_id = "*".
 */
export async function loadConstraints(workspaceKey: string): Promise<string> {
  const supabase = getSupabase();
  const key = workspaceKey || "default";

  const { data, error } = await supabase
    .from("constraints")
    .select("rule")
    .or(`workspace_id.eq.${key},workspace_id.eq.*`);

  if (error || !data || data.length === 0) return "";

  const rules = data.map((c) => `- ${c.rule}`).join("\n");
  return `\n\n# GLOBAL GUARDRAILS\nYou MUST strictly adhere to the following workspace constraints:\n${rules}`;
}
