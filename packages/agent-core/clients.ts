import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";

/**
 * Lazy clients so importing @klaw/core does not crash at build time
 * when env vars are not yet available (e.g. Next build without secrets).
 */

let _supabase: SupabaseClient | null = null;
let _slack: WebClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for @klaw/core"
    );
  }

  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

/** @deprecated Prefer getSupabase() — kept for script-style imports */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});

export function getSlack(): WebClient {
  if (_slack) return _slack;

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN for @klaw/core");
  }

  _slack = new WebClient(token);
  return _slack;
}

/** @deprecated Prefer getSlack() — kept for script-style imports */
export const slack = new Proxy({} as WebClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSlack(), prop, receiver);
  },
});
