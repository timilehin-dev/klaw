import { NextResponse } from "next/server";
import { redis } from "@/lib/redis/client";
import { inngest, verifySlackSignature } from "@klaw/core";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const signature = req.headers.get("x-slack-signature") || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";

  // Skip verify only in explicit local bypass (tests set SLACK_SKIP_VERIFY=1)
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

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 1. Slack URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 2. Deduplication using Upstash Redis
  const eventId = body.event_id;
  if (eventId) {
    try {
      const seen = await redis.sadd("slack:processed_events", eventId);
      if (!seen) {
        return NextResponse.json({ ok: true, deduped: true });
      }
    } catch {
      // Redis optional for local dev
    }
  }

  // 3. Extract event data — heavy work via Inngest
  const event = body.event;
  if (event?.type === "app_mention" || event?.type === "message") {
    if (event.bot_id || event.subtype) {
      return NextResponse.json({ ok: true });
    }

    const workspaceId =
      body.team_id ||
      event.team ||
      body.authorizations?.[0]?.team_id ||
      "default";

    await inngest.send({
      name: "task/received",
      data: {
        threadId: event.thread_ts || event.ts,
        message: event.text,
        triggerSource: "slack",
        channel: event.channel,
        user: event.user,
        workspaceId,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
