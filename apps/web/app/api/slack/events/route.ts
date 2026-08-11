import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();

  // 1. Slack URL verification challenge
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 2. TODO: Add Upstash Redis deduplication here
  // 3. ACK immediately (Slack 3-second timeout rule)
  // TODO: Trigger Inngest event here
  console.log('Received Slack event:', body.event?.type);

  return NextResponse.json({ ok: true });
}
