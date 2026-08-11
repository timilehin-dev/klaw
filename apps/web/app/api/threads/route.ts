import { NextResponse } from "next/server";
import { ensureWorkspace } from "@klaw/core";
import { getSupabase } from "@klaw/core";

/**
 * Create a web UI thread with a valid workspace UUID.
 * (Browser cannot invent workspace_id: 'default' — FK is UUID.)
 */
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
