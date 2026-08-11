import { NextResponse } from "next/server";
import { getSupabase, inngest, verifySlackSignature } from "@klaw/core";

/**
 * Slack Interactivity endpoint (button clicks for HITL approvals).
 * Configure Request URL: https://<host>/api/slack/interactions
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
    const signature = req.headers.get("x-slack-signature") || "";
    const timestamp = req.headers.get("x-slack-request-timestamp") || "";

    if (process.env.SLACK_SKIP_VERIFY !== "1") {
      const verified = verifySlackSignature({
        signingSecret,
        signature,
        timestamp,
        rawBody,
      });
      if (!verified.ok) {
        return NextResponse.json(
          { error: "invalid_slack_signature", reason: verified.reason },
          { status: 401 }
        );
      }
    }

    const params = new URLSearchParams(rawBody);
    const payloadRaw = params.get("payload");
    if (!payloadRaw) {
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
