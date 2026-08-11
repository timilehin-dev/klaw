/**
 * MCP client bridge — list tools and call tools for curated free servers.
 * Supports in-process handlers (always available) and optional stdio spawn.
 */

import {
  FREE_MCP_REGISTRY,
  getMcpServer,
  type McpServerEntry,
} from "./registry";
import {
  callInprocessTool,
  formatMcpCallResult,
  listInprocessTools,
  type McpCallResult,
  type McpToolDef,
} from "./inprocess";

export type ListedMcpTool = McpToolDef & {
  serverId: string;
  serverName: string;
};

export type McpListResult = {
  success: boolean;
  tools: ListedMcpTool[];
  error?: string;
  serverId: string;
};

export type McpInvokeResult = {
  success: boolean;
  text: string;
  raw?: McpCallResult;
  error?: string;
  serverId: string;
  toolName: string;
};

/** List tools for a server id from the free registry */
export async function listMcpTools(serverId: string): Promise<McpListResult> {
  const server = getMcpServer(serverId);
  if (!server) {
    return {
      success: false,
      tools: [],
      error: `Unknown MCP server: ${serverId}`,
      serverId,
    };
  }

  if (server.kind === "inprocess" && server.inprocess) {
    const tools = listInprocessTools(server.inprocess).map((t) => ({
      ...t,
      serverId: server.id,
      serverName: server.name,
    }));
    return { success: true, tools, serverId };
  }

  // stdio path — best-effort; may fail without network/npx
  try {
    const tools = await listStdioTools(server);
    return {
      success: true,
      tools: tools.map((t) => ({
        ...t,
        serverId: server.id,
        serverName: server.name,
      })),
      serverId,
    };
  } catch (e: any) {
    return {
      success: false,
      tools: [],
      error: e?.message || "Failed to list stdio MCP tools",
      serverId,
    };
  }
}

/** Call a tool on a registered free MCP server */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<McpInvokeResult> {
  const server = getMcpServer(serverId);
  if (!server) {
    return {
      success: false,
      text: "",
      error: `Unknown MCP server: ${serverId}`,
      serverId,
      toolName,
    };
  }

  if (server.kind === "inprocess" && server.inprocess) {
    const raw = await callInprocessTool(server.inprocess, toolName, args);
    const text = formatMcpCallResult(raw);
    return {
      success: !raw.isError,
      text,
      raw,
      error: raw.isError ? text : undefined,
      serverId,
      toolName,
    };
  }

  try {
    const raw = await callStdioTool(server, toolName, args);
    const text = formatMcpCallResult(raw);
    return {
      success: !raw.isError,
      text,
      raw,
      error: raw.isError ? text : undefined,
      serverId,
      toolName,
    };
  } catch (e: any) {
    return {
      success: false,
      text: "",
      error: e?.message || "stdio MCP call failed",
      serverId,
      toolName,
    };
  }
}

/** Documented free registry snapshot for agents / docs */
export function describeFreeMcpRegistry(): string {
  return FREE_MCP_REGISTRY.map((s) => {
    const keys = [
      ...(s.requiredEnv || []).map((e) => `required:${e}`),
      ...(s.optionalEnv || []).map((e) => `optional:${e}`),
    ].join(", ");
    return [
      `## ${s.name} (\`${s.id}\`)`,
      s.description,
      `- Kind: ${s.kind}`,
      `- Free: ${s.free}`,
      `- License: ${s.license}`,
      s.kind === "stdio"
        ? `- Run: \`${s.command} ${(s.args || []).join(" ")}\``
        : `- Run: in-process`,
      keys ? `- Env: ${keys}` : `- Env: none`,
      s.notes ? `- Notes: ${s.notes}` : "",
      s.homepage ? `- Home: ${s.homepage}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
}

// ---------------------------------------------------------------------------
// Optional stdio transport (lazy import so unit tests don't need the SDK spawn)
// ---------------------------------------------------------------------------

async function listStdioTools(server: McpServerEntry): Promise<McpToolDef[]> {
  const session = await openStdioSession(server);
  try {
    const result = await session.client.listTools();
    return (result.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }));
  } finally {
    await session.close();
  }
}

async function callStdioTool(
  server: McpServerEntry,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallResult> {
  const session = await openStdioSession(server);
  try {
    const result = await session.client.callTool({
      name: toolName,
      arguments: args,
    });
    const content = (result.content || []).map((c: any) => ({
      type: "text" as const,
      text: c.type === "text" ? c.text : JSON.stringify(c),
    }));
    return {
      content,
      isError: Boolean(result.isError),
    };
  } finally {
    await session.close();
  }
}

async function openStdioSession(server: McpServerEntry): Promise<{
  client: any;
  close: () => Promise<void>;
}> {
  if (!server.command) {
    throw new Error(`Server ${server.id} has no stdio command`);
  }

  // Dynamic import — keeps cold start light when only in-process is used
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    env: process.env as Record<string, string>,
  });

  const client = new Client(
    { name: "klaw-mcp-bridge", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  return {
    client,
    close: async () => {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    },
  };
}
