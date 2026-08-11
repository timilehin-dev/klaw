import { createClient } from "@supabase/supabase-js";

// Browser client — public anon key only (never service role in the browser)
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);
