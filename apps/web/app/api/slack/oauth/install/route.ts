import { NextResponse } from "next/server";

/**
 * Start Slack multi-tenant install (OAuth v2).
 * GET /api/slack/oauth/install
 */
export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!clientId || !baseUrl) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID and NEXT_PUBLIC_BASE_URL are required" },
      { status: 500 }
    );
  }

  const redirectUri = `${baseUrl}/api/slack/oauth/callback`;
  const scopes = [
    "app_mentions:read",
    "channels:history",
    "channels:read",
    "chat:write",
    "commands",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "im:write",
    "mpim:history",
    "mpim:read",
    "mpim:write",
    "reactions:read",
    "reactions:write",
    "team:read",
    "users:read",
    "users.profile:read",
  ].join(",");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(url.toString());
}
