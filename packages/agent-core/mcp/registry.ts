/**
 * Klaw MCP Ecosystem Registry — 16 production servers.
 *
 * Tiers:
 *  1. Self-hosted / free local (native Klaw, in-process, stdio, Modal HTTP)
 *  2. Official remote MCPs (OAuth / API keys — free tiers where available)
 *
 * Adding a server here should NOT require rewriting the agent loop:
 * use mcp_list_servers → mcp_list_tools → mcp_call_tool.
 */

export type McpServerKind =
  | "native" // maps to existing Klaw tools / services
  | "inprocess" // zero-dep free handlers in-process
  | "stdio" // npx official MCP packages
  | "http" // Modal / self-hosted Streamable HTTP MCP
  | "remote"; // vendor-hosted remote MCP (OAuth)

export type McpTier = 1 | 2;

export type McpServerEntry = {
  id: string;
  name: string;
  description: string;
  tier: McpTier;
  kind: McpServerKind;
  /** free to use without paid plan for basic usage */
  free: boolean;
  license?: string;
  status: "ready" | "native" | "pending_oauth" | "optional";
  homepage?: string;
  notes?: string;
  requiredEnv?: string[];
  optionalEnv?: string[];
  /** native: which Klaw capability this maps to */
  native?: "filesystem" | "memory" | "playwright" | "tavily";
  /** in-process handler key */
  inprocess?: "time" | "sequential-thinking" | "echo" | "fetch" | "git";
  /** stdio spawn */
  command?: string;
  args?: string[];
  /** Streamable HTTP endpoint (env override preferred) */
  httpUrlEnv?: string;
  defaultHttpUrl?: string;
  /** remote OAuth / API base */
  remoteUrlEnv?: string;
  defaultRemoteUrl?: string;
};

/**
 * Complete planned catalog (16 servers).
 * Free/public first; paid-only vendors marked optionalEnv / pending_oauth.
 */
export const MCP_REGISTRY: McpServerEntry[] = [
  // ─── Tier 1: Self-hosted / free local ─────────────────────────────────
  {
    id: "filesystem",
    name: "Filesystem",
    description:
      "Secure file read/write via Modal sandbox (/mnt/data) and execute_code.",
    tier: 1,
    kind: "native",
    free: true,
    license: "MIT",
    status: "native",
    native: "filesystem",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    notes:
      "Built natively (Phases 3–5). MCP surface proxies to execute_code workspace paths.",
  },
  {
    id: "memory",
    name: "Memory (Knowledge Graph)",
    description:
      "Persistent entity–relation–observation graph (Supabase multi-tenant).",
    tier: 1,
    kind: "native",
    free: true,
    license: "MIT",
    status: "native",
    native: "memory",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    notes:
      "Built natively in Phase 9 (Supabase) instead of JSONL for multi-tenant scale.",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser automation: navigate, click, type, snapshot.",
    tier: 1,
    kind: "native",
    free: true,
    license: "Apache-2.0",
    status: "native",
    native: "playwright",
    homepage: "https://playwright.dev",
    notes: "Built in Phase 8 as Modal Playwright sandbox + browser_* tools.",
    httpUrlEnv: "MODAL_BROWSER_URL",
  },
  {
    id: "tavily",
    name: "Tavily",
    description: "AI-optimized live web search, extraction, and crawling.",
    tier: 1,
    kind: "native",
    free: true,
    license: "Proprietary API (free tier)",
    status: "native",
    native: "tavily",
    optionalEnv: ["TAVILY_API_KEY"],
    homepage: "https://tavily.com",
    notes: "Built Phase 8 as web_search tool. Free API tier available.",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description:
      "Dynamic, reflective multi-step problem solving before complex tasks.",
    tier: 1,
    kind: "inprocess",
    free: true,
    license: "MIT",
    status: "ready",
    inprocess: "sequential-thinking",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    notes: "In-process free MCP surface (also stdio via npx if desired).",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    id: "git",
    name: "Git",
    description: "Read, search, and inspect Git repositories (read-focused).",
    tier: 1,
    kind: "inprocess",
    free: true,
    license: "MIT",
    status: "ready",
    inprocess: "git",
    homepage: "https://git-scm.com",
    notes:
      "In-process free tools over local git CLI when available; no paid keys.",
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch URL → markdown/text for efficient LLM consumption.",
    tier: 1,
    kind: "inprocess",
    free: true,
    license: "MIT",
    status: "ready",
    inprocess: "fetch",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    notes: "In-process fetch+markdown strip; optional official stdio package.",
  },
  {
    id: "time",
    name: "Time",
    description: "Timezone-aware current time and conversion.",
    tier: 1,
    kind: "inprocess",
    free: true,
    license: "MIT",
    status: "ready",
    inprocess: "time",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    notes: "Zero keys. Always available in-process.",
  },

  // ─── Tier 2: Official remote MCPs (OAuth / vendor-hosted) ─────────────
  {
    id: "github",
    name: "GitHub",
    description: "Read repos, PRs, diffs, issues via remote/stdio MCP.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "optional",
    optionalEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN", "MCP_GITHUB_URL"],
    remoteUrlEnv: "MCP_GITHUB_URL",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    homepage: "https://github.com/github/github-mcp-server",
    notes: "Free PAT for public repos. Prefer remote URL if set, else stdio.",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Query project DB, config, and management APIs.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "Apache-2.0",
    status: "pending_oauth",
    requiredEnv: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    optionalEnv: ["MCP_SUPABASE_URL"],
    remoteUrlEnv: "MCP_SUPABASE_URL",
    homepage: "https://supabase.com/docs",
    notes:
      "Remote MCP when MCP_SUPABASE_URL set; otherwise limited native status via our schema tools.",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, read, create, update pages and databases.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "pending_oauth",
    optionalEnv: ["NOTION_API_KEY", "MCP_NOTION_URL"],
    remoteUrlEnv: "MCP_NOTION_URL",
    homepage: "https://developers.notion.com",
    notes: "Requires free Notion integration token + remote MCP URL.",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Find, create, and update issues, projects, comments.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "pending_oauth",
    optionalEnv: ["LINEAR_API_KEY", "MCP_LINEAR_URL"],
    remoteUrlEnv: "MCP_LINEAR_URL",
    homepage: "https://linear.app/docs",
    notes: "Free Linear API key + remote MCP endpoint.",
  },
  {
    id: "slack-mcp",
    name: "Slack MCP",
    description:
      "Search messages, channel history, post — standardized MCP (alongside Web API).",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "pending_oauth",
    optionalEnv: ["SLACK_BOT_TOKEN", "MCP_SLACK_URL"],
    remoteUrlEnv: "MCP_SLACK_URL",
    homepage: "https://api.slack.com",
    notes: "Native Slack Web API already used; MCP standardizes further.",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Pull production errors, triage, and debug.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "pending_oauth",
    optionalEnv: ["SENTRY_AUTH_TOKEN", "MCP_SENTRY_URL"],
    remoteUrlEnv: "MCP_SENTRY_URL",
    homepage: "https://docs.sentry.io",
    notes: "Free Sentry tier + auth token.",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Customers, payments, subscriptions, refunds, invoices.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "pending_oauth",
    optionalEnv: ["STRIPE_SECRET_KEY", "MCP_STRIPE_URL"],
    remoteUrlEnv: "MCP_STRIPE_URL",
    homepage: "https://docs.stripe.com",
    notes: "Test-mode keys free; live keys optional.",
  },
  {
    id: "context7",
    name: "Context7",
    description:
      "Version-specific library docs (React, Next.js, …) to reduce hallucinations.",
    tier: 2,
    kind: "remote",
    free: true,
    license: "MIT",
    status: "optional",
    optionalEnv: ["CONTEXT7_API_KEY", "MCP_CONTEXT7_URL"],
    remoteUrlEnv: "MCP_CONTEXT7_URL",
    defaultRemoteUrl: "https://mcp.context7.com/mcp",
    homepage: "https://context7.com",
    notes: "Public Context7 MCP endpoint; free tier for docs retrieval.",
  },
];

/** @deprecated use MCP_REGISTRY — kept for older imports */
export const FREE_MCP_REGISTRY = MCP_REGISTRY;

export function getMcpServer(id: string): McpServerEntry | undefined {
  return MCP_REGISTRY.find((s) => s.id === id);
}

export function listMcpServers(filter?: {
  tier?: McpTier;
  freeOnly?: boolean;
}): McpServerEntry[] {
  return MCP_REGISTRY.filter((s) => {
    if (filter?.tier && s.tier !== filter.tier) return false;
    if (filter?.freeOnly && !s.free) return false;
    return true;
  });
}

export function listFreeMcpServers(): McpServerEntry[] {
  return listMcpServers({ freeOnly: true });
}

export function listZeroKeyMcpServers(): McpServerEntry[] {
  return MCP_REGISTRY.filter(
    (s) =>
      s.free &&
      (!s.requiredEnv || s.requiredEnv.length === 0) &&
      (s.kind === "inprocess" || s.kind === "native" || s.status === "ready")
  );
}

export function listReadyMcpServers(): McpServerEntry[] {
  return MCP_REGISTRY.filter(
    (s) => s.status === "ready" || s.status === "native"
  );
}
