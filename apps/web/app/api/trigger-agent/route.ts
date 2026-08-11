import { NextResponse } from "next/server";
import { inngest } from "@klaw/core";

/**
 * Browser-safe entrypoint to fire the agent (Inngest event).
 * Uses server-side Inngest client + service-role path for memory.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { threadId, message, triggerSource = "web", channel, user, workspaceId } =
      body || {};

    if (!threadId || !message) {
      return NextResponse.json(
        { error: "threadId and message are required" },
        { status: 400 }
      );
    }

    await inngest.send({
      name: "task/received",
      data: {
        threadId,
        message,
        triggerSource,
        channel: channel || null,
        user: user || null,
        // Web threads already use internal UUID; workspace resolved at create time
        workspaceId: workspaceId || "web",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to trigger agent" },
      { status: 500 }
    );
  }
}
