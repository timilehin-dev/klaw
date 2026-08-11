import { NextResponse } from "next/server";
import { ensureWorkspace, getSupabase } from "@klaw/core";

/**
 * GET  — list recent web workspace threads (with optional message preview)
 * POST — create a web UI thread with a valid workspace UUID
 */
export async function GET() {
  try {
    const workspaceId = await ensureWorkspace("web", "Klaw Web");
    const supabase = getSupabase();

    const { data: threads, error } = await supabase
      .from("threads")
      .select("id, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const enriched = [];
    for (const t of threads || []) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("content, role")
        .eq("thread_id", t.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const last = msgs?.[0];
      enriched.push({
        ...t,
        preview: last?.content
          ? `${last.role}: ${String(last.content).slice(0, 80)}`
          : undefined,
      });
    }

    return NextResponse.json({ threads: enriched });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const workspaceId = await ensureWorkspace("web", "Klaw Web");
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("threads")
      .insert({
        workspace_id: workspaceId,
        status: "active",
        slack_channel: null,
        slack_thread_ts: null,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to create thread" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}
