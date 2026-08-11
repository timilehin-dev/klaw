import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis/client';
import { inngest } from "@klaw/core";

export async function POST(req: Request) {
  const body = await req.json();

  // 1. Slack URL verification challenge
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 2. Deduplication using Upstash Redis
  const eventId = body.event_id;
  if (eventId) {
    const seen = await redis.sadd('slack:processed_events', eventId);
    if (!seen) {
      // We already processed this event (Slack retries if we don't ack in 3s)
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  // 3. ACK immediately (Slack 3-second timeout rule)
  // We do NOT await any LLM work here.

  // 4. Extract event data
  const event = body.event;
  if (event?.type === 'app_mention' || event?.type === 'message') {
    // Ignore bot messages to prevent infinite loops
    if (event.bot_id || event.subtype) {
      return NextResponse.json({ ok: true });
    }

    // 5. Fire Inngest event — heavy work runs in background
    await inngest.send({
      name: "task/received",
      data: {
        threadId: event.thread_ts || event.ts, // Slack thread timestamp
        message: event.text,
        triggerSource: "slack",
        channel: event.channel,
        user: event.user,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
