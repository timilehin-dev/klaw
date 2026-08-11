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

// ---------------------------------------------------------------------------
// Phase 9: Persistent memory graph
// ---------------------------------------------------------------------------

export async function createMemoryEntity(
  workspaceId: string,
  name: string,
  entityType: string,
  observations: string[] = []
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memory_entities").upsert(
    {
      workspace_id: workspaceId,
      name,
      entity_type: entityType,
      observations,
    },
    { onConflict: "workspace_id,name" }
  );
  if (error) throw new Error(`createMemoryEntity failed: ${error.message}`);
}

export async function addObservation(
  workspaceId: string,
  entityName: string,
  observation: string
): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("memory_entities")
    .select("observations")
    .eq("workspace_id", workspaceId)
    .eq("name", entityName)
    .maybeSingle();

  if (error) throw new Error(`addObservation select failed: ${error.message}`);

  if (!data) {
    await createMemoryEntity(workspaceId, entityName, "concept", [
      observation,
    ]);
    return;
  }

  const prev = Array.isArray(data.observations) ? data.observations : [];
  const next = [...prev, observation];
  const { error: upErr } = await supabase
    .from("memory_entities")
    .update({ observations: next })
    .eq("workspace_id", workspaceId)
    .eq("name", entityName);

  if (upErr) throw new Error(`addObservation update failed: ${upErr.message}`);
}

export async function createMemoryRelation(
  workspaceId: string,
  sourceEntity: string,
  targetEntity: string,
  relationType: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("memory_relations").insert({
    workspace_id: workspaceId,
    source_entity: sourceEntity,
    target_entity: targetEntity,
    relation_type: relationType,
  });
  if (error) throw new Error(`createMemoryRelation failed: ${error.message}`);
}

export async function searchMemory(
  workspaceId: string,
  query: string
): Promise<string> {
  const supabase = getSupabase();
  const q = (query || "").toLowerCase();

  const { data: entities } = await supabase
    .from("memory_entities")
    .select("name, entity_type, observations")
    .eq("workspace_id", workspaceId)
    .limit(100);

  const { data: relations } = await supabase
    .from("memory_relations")
    .select("source_entity, target_entity, relation_type")
    .eq("workspace_id", workspaceId)
    .limit(100);

  const matchedEntities = (entities || []).filter((e) => {
    const obs = Array.isArray(e.observations)
      ? e.observations.join(" ")
      : "";
    const hay = `${e.name} ${e.entity_type} ${obs}`.toLowerCase();
    return !q || hay.includes(q);
  });

  const matchedRelations = (relations || []).filter((r) => {
    const hay =
      `${r.source_entity} ${r.relation_type} ${r.target_entity}`.toLowerCase();
    return !q || hay.includes(q);
  });

  if (matchedEntities.length === 0 && matchedRelations.length === 0) {
    return "No matching memory found.";
  }

  const lines: string[] = ["# Memory search results"];
  for (const e of matchedEntities.slice(0, 20)) {
    const obs = Array.isArray(e.observations)
      ? e.observations.map((o: string) => `  - ${o}`).join("\n")
      : "";
    lines.push(`- Entity: ${e.name} (${e.entity_type})`);
    if (obs) lines.push(obs);
  }
  for (const r of matchedRelations.slice(0, 20)) {
    lines.push(
      `- Relation: ${r.source_entity} —[${r.relation_type}]→ ${r.target_entity}`
    );
  }
  return lines.join("\n");
}

/** Compact memory snapshot for system prompt */
export async function loadMemoryContext(workspaceId: string): Promise<string> {
  const supabase = getSupabase();
  const { data: entities } = await supabase
    .from("memory_entities")
    .select("name, entity_type, observations")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(30);

  const { data: relations } = await supabase
    .from("memory_relations")
    .select("source_entity, target_entity, relation_type")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(30);

  if ((!entities || entities.length === 0) && (!relations || relations.length === 0)) {
    return "";
  }

  const lines = [
    "\n\n# WORKSPACE MEMORY GRAPH",
    "Long-lived facts the agent should reuse. Update via memory tools when you learn something durable.",
  ];

  for (const e of entities || []) {
    const obs = Array.isArray(e.observations) ? e.observations : [];
    const tail = obs.slice(-3).join("; ");
    lines.push(
      `- ${e.name} [${e.entity_type}]${tail ? `: ${tail}` : ""}`
    );
  }
  for (const r of relations || []) {
    lines.push(
      `- ${r.source_entity} —[${r.relation_type}]→ ${r.target_entity}`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Phase 9: Scheduled tasks (proactive autonomy)
// ---------------------------------------------------------------------------

export async function createScheduledTask(input: {
  workspaceId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  slackChannel?: string;
}): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name,
      cron_expression: input.cronExpression,
      prompt: input.prompt,
      slack_channel: input.slackChannel || null,
      active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createScheduledTask failed: ${error?.message || "unknown"}`);
  }
  return { id: data.id as string };
}

export async function listScheduledTasks(
  workspaceId: string
): Promise<
  Array<{
    id: string;
    name: string;
    cron_expression: string;
    prompt: string;
    slack_channel: string | null;
    active: boolean;
    last_run_at: string | null;
  }>
> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select(
      "id, name, cron_expression, prompt, slack_channel, active, last_run_at"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listScheduledTasks failed: ${error.message}`);
  return (data || []) as any;
}

export async function deactivateScheduledTask(taskId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("scheduled_tasks")
    .update({ active: false })
    .eq("id", taskId);
  if (error) throw new Error(`deactivateScheduledTask failed: ${error.message}`);
}
