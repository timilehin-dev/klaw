/**
 * MCP Router / Bridge — plug-and-play list+call for the 16-server registry.
 * Kinds: native | inprocess | stdio | http | remote
 */

import {
  MCP_REGISTRY,
  getMcpServer,
  type McpServerEntry,
} from "./registry";
import {
  callInprocessTool,
  formatMcpCallResult,
  listInprocessTools,
  type InprocessKind,
  type McpCallResult,
  type McpToolDef,
} from "./inprocess";
import { callNativeTool, listNativeTools } from "./native";
import { callHttpTool, listHttpTools } from "./http";

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

export type McpCallContext = {
  workspaceId?: string;
};

/** List tools for a server id from the full registry */
export async function listMcpTools(
  serverId: string,
  ctx: McpCallContext = {}
): Promise<McpListResult> {
  const server = getMcpServer(serverId);
  if (!server) {
    return {
      success: false,
      tools: [],
      error: `Unknown MCP server: ${serverId}`,
      serverId,
    };
  }

  try {
    const tools = await resolveList(server, ctx);
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
      error: e?.message || "Failed to list MCP tools",
      serverId,
    };
  }
}

/** Call a tool on a registered MCP server */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  ctx: McpCallContext = {}
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

  try {
    const raw = await resolveCall(server, toolName, args, ctx);
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
      error: e?.message || "MCP call failed",
      serverId,
      toolName,
    };
  }
}

/** Full catalog description for agents / docs */
export function describeFreeMcpRegistry(): string {
  return MCP_REGISTRY.map((s) => {
    const keys = [
      ...(s.requiredEnv || []).map((e) => `required:${e}`),
      ...(s.optionalEnv || []).map((e) => `optional:${e}`),
    ].join(", ");
    return [
      `## ${s.name} (\`${s.id}\`) — Tier ${s.tier}`,
      s.description,
      `- Kind: ${s.kind} | Status: ${s.status} | Free: ${s.free}`,
      s.license ? `- License: ${s.license}` : "",
      keys ? `- Env: ${keys}` : `- Env: none required for basic free path`,
      s.notes ? `- Notes: ${s.notes}` : "",
      s.homepage ? `- Home: ${s.homepage}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
}

// ─── dispatch ───────────────────────────────────────────────────────────────

async function resolveList(
  server: McpServerEntry,
  ctx: McpCallContext
): Promise<McpToolDef[]> {
  if (server.kind === "native" && server.native) {
    return listNativeTools(server.native);
  }
  if (server.kind === "inprocess" && server.inprocess) {
    return listInprocessTools(server.inprocess as InprocessKind);
  }

  const httpUrl = resolveHttpUrl(server);
  if (
    (server.kind === "http" || server.kind === "remote") &&
    httpUrl
  ) {
    try {
      return await listHttpTools(httpUrl);
    } catch {
      // fall through to stdio if configured
    }
  }

  if (server.command) {
    return listStdioTools(server);
  }

  if (server.kind === "remote" && !httpUrl) {
    return [
      {
        name: "configure",
        description: `Set ${server.remoteUrlEnv || "MCP URL"} and auth env to enable this remote MCP.`,
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  throw new Error(`No list strategy for server ${server.id} (${server.kind})`);
}

async function resolveCall(
  server: McpServerEntry,
  toolName: string,
  args: Record<string, unknown>,
  ctx: McpCallContext
): Promise<McpCallResult> {
  if (server.kind === "native" && server.native) {
    return callNativeTool(server.native, toolName, args, {
      workspaceId: ctx.workspaceId,
    });
  }
  if (server.kind === "inprocess" && server.inprocess) {
    return callInprocessTool(
      server.inprocess as InprocessKind,
      toolName,
      args
    );
  }

  const httpUrl = resolveHttpUrl(server);
  if ((server.kind === "http" || server.kind === "remote") && httpUrl) {
    const headers = authHeaders(server);
    // Modal single-endpoint wrappers: send full payload
    if (httpUrl.includes("modal.run") || server.kind === "http") {
      return callModalStyle(httpUrl, toolName, args, headers);
    }
    return callHttpTool(httpUrl, toolName, args, headers);
  }

  if (server.command) {
    return callStdioTool(server, toolName, args);
  }

  if (toolName === "configure") {
    return {
      content: [
        {
          type: "text",
          text: `Configure remote MCP '${server.id}' by setting env: ${[
            ...(server.requiredEnv || []),
            ...(server.optionalEnv || []),
          ].join(", ")}`,
        },
      ],
    };
  }

  throw new Error(
    `Server '${server.id}' is not callable yet (${server.status}). ${server.notes || ""}`
  );
}

function resolveHttpUrl(server: McpServerEntry): string | undefined {
  if (server.httpUrlEnv && process.env[server.httpUrlEnv]) {
    return process.env[server.httpUrlEnv];
  }
  if (server.remoteUrlEnv && process.env[server.remoteUrlEnv]) {
    return process.env[server.remoteUrlEnv];
  }
  return server.defaultHttpUrl || server.defaultRemoteUrl;
}

function authHeaders(server: McpServerEntry): Record<string, string> {
  const h: Record<string, string> = {};
  if (server.id === "github" && process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}`;
  }
  if (server.id === "notion" && process.env.NOTION_API_KEY) {
    h.Authorization = `Bearer ${process.env.NOTION_API_KEY}`;
  }
  if (server.id === "linear" && process.env.LINEAR_API_KEY) {
    h.Authorization = process.env.LINEAR_API_KEY;
  }
  if (server.id === "sentry" && process.env.SENTRY_AUTH_TOKEN) {
    h.Authorization = `Bearer ${process.env.SENTRY_AUTH_TOKEN}`;
  }
  if (server.id === "stripe" && process.env.STRIPE_SECRET_KEY) {
    h.Authorization = `Bearer ${process.env.STRIPE_SECRET_KEY}`;
  }
  if (server.id === "context7" && process.env.CONTEXT7_API_KEY) {
    h.Authorization = `Bearer ${process.env.CONTEXT7_API_KEY}`;
  }
  return h;
}

/** Modal function endpoints often accept a single POST body */
async function callModalStyle(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
  headers: Record<string, string>
): Promise<McpCallResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      name: toolName,
      tool: toolName,
      arguments: args,
      ...args,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      content: [
        {
          type: "text",
          text: `Modal/HTTP MCP ${res.status}: ${res.statusText} ${body}`,
        },
      ],
      isError: true,
    };
  }
  const data = await res.json();
  if (data.content) {
    return { content: data.content, isError: Boolean(data.isError) };
  }
  const text =
    typeof data.content === "string"
      ? data.content
      : data.success === false
        ? data.error || JSON.stringify(data)
        : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text }],
    isError: data.success === false || Boolean(data.error),
  };
}

// ─── stdio (optional) ───────────────────────────────────────────────────────

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
    return { content, isError: Boolean(result.isError) };
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
    { name: "klaw-mcp-router", version: "1.0.0" },
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
