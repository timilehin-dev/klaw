/**
 * Native MCP adapters — map registry "native" servers onto existing Klaw tools.
 */

import type { McpCallResult, McpToolDef } from "./inprocess";
import { tavilySearch } from "../tools/tavily";
import { runBrowserAction } from "../tools/browser";
import {
  createMemoryEntity,
  searchMemory,
  createMemoryRelation,
  addObservation,
} from "../memory";

export function listNativeTools(
  native: "filesystem" | "memory" | "playwright" | "tavily"
): McpToolDef[] {
  if (native === "filesystem") {
    return [
      {
        name: "write_file_hint",
        description:
          "Guidance: write files under /mnt/data via execute_code. Returns path conventions.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path under /mnt/data" },
          },
        },
      },
      {
        name: "list_workspace_paths",
        description: "Describe the Modal sandbox workspace layout.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }
  if (native === "memory") {
    return [
      {
        name: "create_entities",
        description: "Create/update a memory entity with observations.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            entityType: { type: "string" },
            observations: { type: "array", items: { type: "string" } },
            workspace_id: { type: "string" },
          },
          required: ["name", "entityType"],
        },
      },
      {
        name: "add_observations",
        description: "Add an observation to an entity.",
        inputSchema: {
          type: "object",
          properties: {
            entityName: { type: "string" },
            observation: { type: "string" },
            workspace_id: { type: "string" },
          },
          required: ["entityName", "observation"],
        },
      },
      {
        name: "create_relations",
        description: "Create a relation between entities.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            relationType: { type: "string" },
            workspace_id: { type: "string" },
          },
          required: ["from", "to", "relationType"],
        },
      },
      {
        name: "search_nodes",
        description: "Search the Supabase memory graph.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            workspace_id: { type: "string" },
          },
          required: ["query"],
        },
      },
    ];
  }
  if (native === "playwright") {
    return [
      {
        name: "browser_navigate",
        description: "Navigate to URL and return page text.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      {
        name: "browser_click",
        description: "Click selector on page.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            selector: { type: "string" },
          },
          required: ["url", "selector"],
        },
      },
      {
        name: "browser_type",
        description: "Type into a selector and submit.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            selector: { type: "string" },
            text: { type: "string" },
          },
          required: ["url", "selector", "text"],
        },
      },
    ];
  }
  // tavily
  return [
    {
      name: "tavily_search",
      description: "Live web search via Tavily.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number" },
        },
        required: ["query"],
      },
    },
  ];
}

export async function callNativeTool(
  native: "filesystem" | "memory" | "playwright" | "tavily",
  toolName: string,
  args: Record<string, unknown>,
  ctx: { workspaceId?: string } = {}
): Promise<McpCallResult> {
  const ws = String(args.workspace_id || ctx.workspaceId || "web");

  try {
    if (native === "filesystem") {
      if (toolName === "list_workspace_paths") {
        return ok(
          JSON.stringify(
            {
              workspace: "/mnt/data",
              note: "Use agent tool execute_code to write/read files here. Outputs become Cabinet artifacts.",
            },
            null,
            2
          )
        );
      }
      if (toolName === "write_file_hint") {
        const p = String(args.path || "output.txt");
        return ok(
          `Write via execute_code:\nopen('/mnt/data/${p.replace(/^\/+/, "")}','w').write(...)\nThen the agent persists artifacts automatically.`
        );
      }
      return err(`Unknown filesystem tool: ${toolName}`);
    }

    if (native === "memory") {
      if (toolName === "create_entities") {
        await createMemoryEntity(
          ws,
          String(args.name),
          String(args.entityType || "concept"),
          Array.isArray(args.observations)
            ? args.observations.map(String)
            : []
        );
        return ok(`Entity saved: ${args.name}`);
      }
      if (toolName === "add_observations") {
        await addObservation(
          ws,
          String(args.entityName),
          String(args.observation)
        );
        return ok(`Observation added to ${args.entityName}`);
      }
      if (toolName === "create_relations") {
        await createMemoryRelation(
          ws,
          String(args.from),
          String(args.to),
          String(args.relationType)
        );
        return ok(`Relation ${args.from} -[${args.relationType}]-> ${args.to}`);
      }
      if (toolName === "search_nodes") {
        const r = await searchMemory(ws, String(args.query || ""));
        return ok(r);
      }
      return err(`Unknown memory tool: ${toolName}`);
    }

    if (native === "playwright") {
      const action =
        toolName === "browser_navigate"
          ? "navigate"
          : toolName === "browser_click"
            ? "click"
            : toolName === "browser_type"
              ? "type"
              : null;
      if (!action) return err(`Unknown playwright tool: ${toolName}`);
      const r = await runBrowserAction({
        action: action as any,
        url: String(args.url || ""),
        selector: args.selector ? String(args.selector) : undefined,
        text: args.text ? String(args.text) : undefined,
      });
      if (!r.success) return err(r.error || "browser failed");
      return ok(
        `URL: ${r.url}\nTitle: ${r.title || ""}\n\n${r.content || ""}`
      );
    }

    if (native === "tavily") {
      if (toolName !== "tavily_search") {
        return err(`Unknown tavily tool: ${toolName}`);
      }
      const r = await tavilySearch(String(args.query || ""), {
        maxResults: Number(args.max_results) || 5,
      });
      if (!r.success) return err(r.error || "tavily failed");
      return ok(r.summary);
    }

    return err(`Unknown native kind: ${native}`);
  } catch (e: any) {
    return err(e?.message || "native MCP call failed");
  }
}

function ok(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: false };
}
function err(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: true };
}
