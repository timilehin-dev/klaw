/**
 * In-process free MCP-compatible tool handlers.
 * Mirror public MCP server tool surfaces without requiring child processes.
 */

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function listInprocessTools(
  kind: "time" | "sequential-thinking" | "echo"
): McpToolDef[] {
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
          required: ["thought", "thoughtNumber", "totalThoughts", "nextThoughtNeeded"],
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
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  ];
}

export async function callInprocessTool(
  kind: "time" | "sequential-thinking" | "echo",
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallResult> {
  try {
    if (kind === "echo") {
      if (toolName !== "echo") {
        return textError(`Unknown tool: ${toolName}`);
      }
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
            {
              timezone: tz,
              datetime: now.toISOString(),
              formatted,
            },
            null,
            2
          )
        );
      }
      if (toolName === "convert_time") {
        // Simplified conversion: interpret time as today HH:mm in from_tz if not ISO
        const fromTz = String(args.from_timezone || "UTC");
        const toTz = String(args.to_timezone || "UTC");
        const timeStr = String(args.time || "");
        const base = timeStr.includes("T")
          ? new Date(timeStr)
          : new Date();
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
            status: next
              ? "continue"
              : "complete",
          },
          null,
          2
        )
      );
    }

    return textError(`Unknown in-process kind: ${kind}`);
  } catch (e: any) {
    return textError(e?.message || "in-process MCP call failed");
  }
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
