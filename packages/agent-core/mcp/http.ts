/**
 * Streamable HTTP MCP / JSON tool bridge for Modal-hosted or remote endpoints.
 */

import type { McpCallResult, McpToolDef } from "./inprocess";

/**
 * Generic HTTP tool call used for:
 * - Modal streamable HTTP MCP wrappers (MCP_*_HTTP_URL)
 * - Vendor remote MCPs that speak JSON { tools } / { name, arguments }
 *
 * Many remote MCPs use the MCP Streamable HTTP transport; we also support a
 * simple Klaw JSON profile for Modal wrappers:
 *   GET  /tools  → { tools: McpToolDef[] }
 *   POST /call   → { name, arguments } → { content, isError }
 */
export async function listHttpTools(baseUrl: string): Promise<McpToolDef[]> {
  const url = joinUrl(baseUrl, "tools");
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    // Try MCP-style initialize/list is too heavy; surface error
    throw new Error(`HTTP list tools failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (Array.isArray(data.tools)) return data.tools;
  if (Array.isArray(data)) return data;
  throw new Error("Unexpected tools payload from HTTP MCP endpoint");
}

export async function callHttpTool(
  baseUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<McpCallResult> {
  const url = joinUrl(baseUrl, "call");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify({ name: toolName, arguments: args }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      content: [
        {
          type: "text",
          text: `HTTP MCP error ${res.status}: ${res.statusText} ${body}`,
        },
      ],
      isError: true,
    };
  }

  const data = await res.json();
  if (data.content) {
    return {
      content: data.content,
      isError: Boolean(data.isError),
    };
  }
  // Plain text / result field adapters
  const text =
    typeof data.result === "string"
      ? data.result
      : typeof data.text === "string"
        ? data.text
        : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }], isError: Boolean(data.error) };
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  // If base already looks like a full tool endpoint, use as-is for call
  if (path === "call" && (b.includes("modal.run") || b.endsWith("/call"))) {
    // Modal function URLs are often a single endpoint — POST body with action
    return b;
  }
  if (path === "tools" && b.includes("modal.run")) {
    return b; // some wrappers list on GET same URL
  }
  return `${b}/${path.replace(/^\/+/, "")}`;
}
