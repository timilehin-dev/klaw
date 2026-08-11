import { getSupabase } from "./clients";
import { decrypt } from "@klaw/database/crypto";
import { WebClient } from "@slack/web-api";

/**
 * Resolve bot token for a Slack team (multi-tenant OAuth).
 * Falls back to SLACK_BOT_TOKEN env for single-workspace dev.
 */
export async function getWorkspaceBotToken(
  slackTeamId: string
): Promise<string | null> {
  try {
    const { data } = await getSupabase()
      .from("workspaces")
      .select("slack_bot_token_encrypted")
      .eq("slack_team_id", slackTeamId)
      .maybeSingle();

    if (data?.slack_bot_token_encrypted) {
      return decrypt(data.slack_bot_token_encrypted as string);
    }
  } catch (e) {
    console.error("getWorkspaceBotToken error:", e);
  }

  return process.env.SLACK_BOT_TOKEN || null;
}

export async function getWorkspaceSlackClient(
  slackTeamId: string
): Promise<WebClient | null> {
  const token = await getWorkspaceBotToken(slackTeamId);
  if (!token) return null;
  return new WebClient(token);
}
