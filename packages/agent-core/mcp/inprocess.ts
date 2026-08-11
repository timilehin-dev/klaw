/**
 * In-process free MCP-compatible tool handlers.
 * Mirror public MCP server tool surfaces without requiring child processes.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type InprocessKind =
  | "time"
  | "sequential-thinking"
  | "echo"
  | "fetch"
  | "git";

export function listInprocessTools(kind: InprocessKind): McpToolDef[] {
  if (kind === "time") {
    return [
      {
        name: "get_current_time",
        description: "Get the current time in a timezone (IANA name or UTC).",
        inputSchema: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description: "IANA timezone, e.g. America/New_York. Default UTC.",
            },
          },
        },
      },
      {
        name: "convert_time",
        description: "Convert a time between timezones.",
        inputSchema: {
          type: "object",
          properties: {
            time: { type: "string", description: "ISO-8601 or HH:mm" },
            from_timezone: { type: "string" },
            to_timezone: { type: "string" },
          },
          required: ["time", "from_timezone", "to_timezone"],
        },
      },
    ];
  }
  if (kind === "sequential-thinking") {
    return [
      {
        name: "sequentialthinking",
        description:
          "Record a structured thought step in a multi-step problem-solving sequence.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string" },
            thoughtNumber: { type: "number" },
            totalThoughts: { type: "number" },
            nextThoughtNeeded: { type: "boolean" },
          },
          required: [
            "thought",
            "thoughtNumber",
            "totalThoughts",
            "nextThoughtNeeded",
          ],
        },
      },
    ];
  }
  if (kind === "fetch") {
    return [
      {
        name: "fetch",
        description:
          "Fetch a URL and return text/markdown-ish content for LLM use.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            max_length: {
              type: "number",
              description: "Max characters to return (default 12000).",
            },
          },
          required: ["url"],
        },
      },
    ];
  }
  if (kind === "git") {
    return [
      {
        name: "git_status",
        description: "Show git status of a repository path (default cwd).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repo root path." },
          },
        },
      },
      {
        name: "git_log",
        description: "Show recent git log (oneline).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            n: { type: "number", description: "Number of commits (default 10)." },
          },
        },
      },
      {
        name: "git_show",
        description: "Show a file at HEAD or a ref.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repo root." },
            file: { type: "string", description: "File path relative to repo." },
            ref: { type: "string", description: "Git ref (default HEAD)." },
          },
          required: ["file"],
        },
      },
    ];
  }
  return [
    {
      name: "echo",
      description: "Echo message back (MCP bridge smoke test).",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  ];
}

export async function callInprocessTool(
  kind: InprocessKind,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallResult> {
  try {
    if (kind === "echo") {
      if (toolName !== "echo") return textError(`Unknown tool: ${toolName}`);
      return textOk(String(args.message ?? ""));
    }

    if (kind === "time") {
      if (toolName === "get_current_time") {
        const tz = String(args.timezone || "UTC");
        const now = new Date();
        let formatted: string;
        try {
          formatted = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            dateStyle: "full",
            timeStyle: "long",
          }).format(now);
        } catch {
          return textError(`Invalid timezone: ${tz}`);
        }
        return textOk(
          JSON.stringify(
            { timezone: tz, datetime: now.toISOString(), formatted },
            null,
            2
          )
        );
      }
      if (toolName === "convert_time") {
        const fromTz = String(args.from_timezone || "UTC");
        const toTz = String(args.to_timezone || "UTC");
        const timeStr = String(args.time || "");
        const base = timeStr.includes("T") ? new Date(timeStr) : new Date();
        if (Number.isNaN(base.getTime())) {
          return textError(`Invalid time: ${timeStr}`);
        }
        try {
          const converted = new Intl.DateTimeFormat("en-US", {
            timeZone: toTz,
            dateStyle: "full",
            timeStyle: "long",
          }).format(base);
          return textOk(
            JSON.stringify(
              {
                from_timezone: fromTz,
                to_timezone: toTz,
                source: timeStr,
                converted,
                iso: base.toISOString(),
              },
              null,
              2
            )
          );
        } catch (e: any) {
          return textError(e?.message || "convert_time failed");
        }
      }
      return textError(`Unknown time tool: ${toolName}`);
    }

    if (kind === "sequential-thinking") {
      if (toolName !== "sequentialthinking") {
        return textError(`Unknown tool: ${toolName}`);
      }
      const thought = String(args.thought || "");
      const n = Number(args.thoughtNumber || 1);
      const total = Number(args.totalThoughts || 1);
      const next = Boolean(args.nextThoughtNeeded);
      return textOk(
        JSON.stringify(
          {
            thoughtNumber: n,
            totalThoughts: total,
            nextThoughtNeeded: next,
            thought,
            status: next ? "continue" : "complete",
          },
          null,
          2
        )
      );
    }

    if (kind === "fetch") {
      if (toolName !== "fetch") return textError(`Unknown tool: ${toolName}`);
      const url = String(args.url || "");
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return textError("url must be http(s)");
      }
      const maxLen = Math.min(Number(args.max_length) || 12000, 50000);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Klaw-MCP-Fetch/1.0 (+https://github.com/timilehin-dev/klaw)",
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
        },
      });
      if (!res.ok) {
        return textError(`HTTP ${res.status} ${res.statusText}`);
      }
      const ct = res.headers.get("content-type") || "";
      let text = await res.text();
      if (ct.includes("html")) {
        text = htmlToApproxMarkdown(text);
      }
      if (text.length > maxLen) {
        text =
          text.slice(0, maxLen) +
          `\n...[truncated ${text.length - maxLen} chars]`;
      }
      return textOk(`# Fetch ${url}\n\n${text}`);
    }

    if (kind === "git") {
      const cwd = String(args.path || process.cwd());
      if (toolName === "git_status") {
        const { stdout } = await execFileAsync("git", ["status", "--short", "--branch"], {
          cwd,
          timeout: 15000,
        });
        return textOk(stdout || "(clean)");
      }
      if (toolName === "git_log") {
        const n = Math.min(Number(args.n) || 10, 50);
        const { stdout } = await execFileAsync(
          "git",
          ["log", `-${n}`, "--oneline", "--decorate"],
          { cwd, timeout: 15000 }
        );
        return textOk(stdout || "(no commits)");
      }
      if (toolName === "git_show") {
        const file = String(args.file || "");
        const ref = String(args.ref || "HEAD");
        if (!file) return textError("file is required");
        const { stdout } = await execFileAsync(
          "git",
          ["show", `${ref}:${file}`],
          { cwd, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
        );
        const body =
          stdout.length > 20000
            ? stdout.slice(0, 20000) + "\n...[truncated]"
            : stdout;
        return textOk(body);
      }
      return textError(`Unknown git tool: ${toolName}`);
    }

    return textError(`Unknown in-process kind: ${kind}`);
  } catch (e: any) {
    return textError(e?.message || "in-process MCP call failed");
  }
}

function htmlToApproxMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => "#".repeat(Number(n)) + " ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOk(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: false };
}

function textError(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Flatten MCP content blocks to a single string for the agent */
export function formatMcpCallResult(result: McpCallResult): string {
  const parts = (result.content || []).map((c) =>
    c.type === "text" ? c.text : JSON.stringify(c)
  );
  const body = parts.join("\n").trim();
  if (result.isError) {
    return `MCP error: ${body || "unknown error"}`;
  }
  return body || "(empty MCP result)";
}
