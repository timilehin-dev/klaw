import { NextResponse } from "next/server";
import { getSupabase } from "@klaw/core";
import { encrypt } from "@klaw/database/crypto";

/**
 * Slack OAuth v2 callback — stores encrypted bot token per workspace.
 * GET /api/slack/oauth/callback?code=...
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not configured" },
      { status: 500 }
    );
  }

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${baseUrl}/api/slack/oauth/callback`,
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    return NextResponse.json(
      { error: data.error || "oauth.v2.access failed" },
      { status: 400 }
    );
  }

  const encryptedToken = encrypt(data.access_token as string);

  const { error } = await getSupabase().from("workspaces").upsert(
    {
      slack_team_id: data.team.id,
      slack_team_name: data.team.name,
      slack_bot_token_encrypted: encryptedToken,
      slack_bot_user_id: data.bot_user_id,
    },
    { onConflict: "slack_team_id" }
  );

  if (error) {
    return NextResponse.json(
      { error: `Failed to save workspace: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.redirect(`${baseUrl}/dashboard?installed=true`);
}
