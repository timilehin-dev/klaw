import { NextResponse } from "next/server";
import { getSupabase } from "@klaw/core";

/**
 * Server-side thread payload (service role) so the dashboard works under
 * workspace-scoped RLS without exposing the service key to the browser.
 */
export async function GET(
  _req: Request,
  ctx: { params: { threadId: string } }
) {
  try {
    const threadId = ctx.params.threadId;
    if (!threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }

    const supabase = getSupabase();

    const [messages, logs, artifacts, approvals] = await Promise.all([
      supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true }),
      supabase
        .from("agent_logs")
        .select("id, step_name, status, detail, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true }),
      supabase
        .from("artifacts")
        .select("id, type, file_path, metadata, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false }),
      supabase
        .from("approvals")
        .select("id, tool_call_id, code_preview, status, created_at")
        .eq("thread_id", threadId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    const err =
      messages.error || logs.error || artifacts.error || approvals.error;
    if (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    return NextResponse.json({
      messages: messages.data || [],
      logs: logs.data || [],
      artifacts: artifacts.data || [],
      approvals: approvals.data || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}
