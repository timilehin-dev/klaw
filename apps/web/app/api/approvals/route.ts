import { NextResponse } from "next/server";
import { getSupabase, inngest } from "@klaw/core";

/**
 * Web HITL: resolve a pending approval (dashboard / API).
 * Body: { toolCallId: string, approved: boolean, threadId?: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { toolCallId, approved, threadId } = body || {};

    if (!toolCallId || typeof approved !== "boolean") {
      return NextResponse.json(
        { error: "toolCallId and approved (boolean) are required" },
        { status: 400 }
      );
    }

    const status = approved ? "approved" : "denied";

    const { error } = await getSupabase()
      .from("approvals")
      .update({ status })
      .eq("tool_call_id", toolCallId)
      .eq("status", "pending");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await inngest.send({
      name: "approval/resolved",
      data: {
        threadId: threadId || null,
        toolCallId,
        approved,
        actor: "web",
      },
    });

    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to resolve approval" },
      { status: 500 }
    );
  }
}

/** List pending approvals for a thread (dashboard) */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    if (!threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }

    const { data, error } = await getSupabase()
      .from("approvals")
      .select("id, tool_call_id, code_preview, status, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ approvals: data || [] });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to list approvals" },
      { status: 500 }
    );
  }
}
