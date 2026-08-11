import { NextResponse } from "next/server";
import { getSupabase, inngest } from "@klaw/core";

/**
 * Slack Interactivity endpoint (button clicks for HITL approvals).
 * Configure Request URL: https://<host>/api/slack/interactions
 *
 * Note: Slack sends application/x-www-form-urlencoded with a `payload` JSON field.
 * Action type for Block Kit buttons is `block_actions` (not interactive_action).
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const payloadRaw = formData.get("payload");
    if (!payloadRaw || typeof payloadRaw !== "string") {
      return NextResponse.json({ error: "No payload" }, { status: 400 });
    }

    const interaction = JSON.parse(payloadRaw);

    if (interaction.type !== "block_actions") {
      return NextResponse.json({ ok: true });
    }

    const action = interaction.actions?.[0];
    if (!action) {
      return NextResponse.json({ ok: true });
    }

    // value carries JSON: { toolCallId, threadId, decision }
    // action_id is approve_code | deny_code
    let meta: {
      toolCallId?: string;
      threadId?: string;
      decision?: "approved" | "denied";
    } = {};

    try {
      meta = JSON.parse(action.value || "{}");
    } catch {
      return NextResponse.json({ error: "Invalid action value" }, { status: 400 });
    }

    const toolCallId = meta.toolCallId;
    const threadId = meta.threadId;
    const isApproved =
      meta.decision === "approved" ||
      action.action_id === "approve_code" ||
      String(action.action_id || "").startsWith("approve");

    if (!toolCallId) {
      return NextResponse.json({ error: "Missing toolCallId" }, { status: 400 });
    }

    const status = isApproved ? "approved" : "denied";

    await getSupabase()
      .from("approvals")
      .update({ status })
      .eq("tool_call_id", toolCallId)
      .eq("status", "pending");

    await inngest.send({
      name: "approval/resolved",
      data: {
        threadId: threadId || null,
        toolCallId,
        approved: isApproved,
        actor: interaction.user?.id || null,
      },
    });

    const who = interaction.user?.id
      ? `<@${interaction.user.id}>`
      : "a user";

    return NextResponse.json({
      replace_original: true,
      text: `Request ${isApproved ? "✅ Approved" : "❌ Denied"} by ${who}.`,
    });
  } catch (e: any) {
    console.error("slack interactions error:", e);
    return NextResponse.json(
      { error: e?.message || "Interaction failed" },
      { status: 500 }
    );
  }
}
