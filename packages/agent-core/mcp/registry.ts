/**
 * Curated free / publicly usable MCP servers for Klaw.
 * Prefer zero-key open-source servers. Optional free-tier keys are marked.
 */

export type McpServerKind = "stdio" | "inprocess";

export type McpServerEntry = {
  /** Stable id used by agent tools */
  id: string;
  name: string;
  description: string;
  /** open-source / free-to-run */
  license: string;
  /** true if no paid plan is required for basic use */
  free: boolean;
  /** optional env vars (even if free tier) */
  optionalEnv?: string[];
  requiredEnv?: string[];
  kind: McpServerKind;
  /** stdio spawn config (npx packages from modelcontextprotocol/servers) */
  command?: string;
  args?: string[];
  /** in-process handler key */
  inprocess?: "time" | "sequential-thinking" | "echo";
  homepage?: string;
  notes?: string;
};

/**
 * Curated set — public, free-to-run MCP-compatible capabilities.
 * Official reference servers: https://github.com/modelcontextprotocol/servers
 */
export const FREE_MCP_REGISTRY: McpServerEntry[] = [
  {
    id: "time",
    name: "Time",
    description:
      "Current time and timezone conversion (mirrors official Time MCP).",
    license: "MIT",
    free: true,
    kind: "inprocess",
    inprocess: "time",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    notes: "Zero keys. In-process for reliable agent use; same tool surface as public Time MCP.",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description:
      "Structured multi-step problem solving through thought sequences.",
    license: "MIT",
    free: true,
    kind: "inprocess",
    inprocess: "sequential-thinking",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    notes: "Zero keys. In-process implementation of the public Sequential Thinking tool schema.",
  },
  {
    id: "echo",
    name: "Echo (debug)",
    description: "Echo back arguments — used for MCP bridge smoke tests.",
    license: "MIT",
    free: true,
    kind: "inprocess",
    inprocess: "echo",
    notes: "Always free; no external process.",
  },
  {
    id: "fetch",
    name: "Fetch (stdio)",
    description: "Official Fetch MCP — fetch URL content for LLM use.",
    license: "MIT",
    free: true,
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    notes: "Zero keys. Requires network + npx to spawn. Optional in constrained environments.",
  },
  {
    id: "filesystem",
    name: "Filesystem (stdio)",
    description: "Official Filesystem MCP — read/write under an allowed root.",
    license: "MIT",
    free: true,
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    notes: "Zero keys. Sandboxed to process.cwd() by default via args.",
  },
  {
    id: "memory",
    name: "Memory (stdio)",
    description: "Official Memory MCP — knowledge-graph style memory server.",
    license: "MIT",
    free: true,
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    notes: "Zero keys. Complementary to Klaw Supabase memory graph.",
  },
  {
    id: "github",
    name: "GitHub (stdio, optional free PAT)",
    description: "Community/official GitHub MCP for repo operations.",
    license: "MIT",
    free: true,
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    optionalEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    notes:
      "Free for public repos with a free GitHub PAT. Marked optional — not required for gating.",
  },
];

export function getMcpServer(id: string): McpServerEntry | undefined {
  return FREE_MCP_REGISTRY.find((s) => s.id === id);
}

export function listFreeMcpServers(): McpServerEntry[] {
  return FREE_MCP_REGISTRY.filter((s) => s.free);
}

export function listZeroKeyMcpServers(): McpServerEntry[] {
  return FREE_MCP_REGISTRY.filter(
    (s) => s.free && (!s.requiredEnv || s.requiredEnv.length === 0)
  );
}
