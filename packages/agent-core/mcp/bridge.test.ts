import { describe, expect, it } from "vitest";
import {
  callMcpTool,
  describeFreeMcpRegistry,
  listMcpTools,
} from "./bridge";
import {
  MCP_REGISTRY,
  getMcpServer,
  listReadyMcpServers,
  listZeroKeyMcpServers,
} from "./registry";
import { formatMcpCallResult } from "./inprocess";

describe("16-server MCP registry", () => {
  it("contains all 16 planned servers", () => {
    expect(MCP_REGISTRY).toHaveLength(16);
    const ids = MCP_REGISTRY.map((s) => s.id);
    for (const id of [
      "filesystem",
      "memory",
      "playwright",
      "tavily",
      "sequential-thinking",
      "git",
      "fetch",
      "time",
      "github",
      "supabase",
      "notion",
      "linear",
      "slack-mcp",
      "sentry",
      "stripe",
      "context7",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("tier1 ready/native servers are free and zero-key for basic path", () => {
    const ready = listReadyMcpServers().filter((s) => s.tier === 1);
    expect(ready.length).toBeGreaterThanOrEqual(8);
    expect(getMcpServer("time")?.status).toBe("ready");
    expect(getMcpServer("fetch")?.status).toBe("ready");
    expect(getMcpServer("git")?.status).toBe("ready");
    expect(getMcpServer("sequential-thinking")?.status).toBe("ready");
    expect(getMcpServer("filesystem")?.status).toBe("native");
  });

  it("describe catalog documents tiers", () => {
    const doc = describeFreeMcpRegistry();
    expect(doc).toContain("Tier 1");
    expect(doc).toContain("Tier 2");
    expect(doc).toContain("context7");
  });
});

describe("MCP bridge list + call", () => {
  it("lists time tools", async () => {
    const listed = await listMcpTools("time");
    expect(listed.success).toBe(true);
    expect(listed.tools.some((t) => t.name === "get_current_time")).toBe(true);
  });

  it("calls get_current_time end-to-end through callMcpTool", async () => {
    const result = await callMcpTool("time", "get_current_time", {
      timezone: "UTC",
    });
    expect(result.success).toBe(true);
    expect(result.text).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("calls sequentialthinking tool", async () => {
    const result = await callMcpTool(
      "sequential-thinking",
      "sequentialthinking",
      {
        thought: "Break the problem into steps",
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
      }
    );
    expect(result.success).toBe(true);
    expect(result.text).toContain("Break the problem into steps");
  });

  it("fetch tool returns content for example.com", async () => {
    const result = await callMcpTool("fetch", "fetch", {
      url: "https://example.com",
      max_length: 2000,
    });
    // Network may fail in some CI — assert real path either succeeds or errors honestly
    if (result.success) {
      expect(result.text.toLowerCase()).toMatch(/example|domain|internet/);
    } else {
      expect(result.error || result.text).toBeTruthy();
    }
  });

  it("git_status runs via in-process git tools", async () => {
    const result = await callMcpTool("git", "git_status", {
      path: process.cwd(),
    });
    // git may not be installed in some envs
    if (result.success) {
      expect(result.text.length).toBeGreaterThan(0);
    } else {
      expect(result.error || result.text).toMatch(/git|not|fail|spawn|ENOENT/i);
    }
  });

  it("filesystem native lists workspace paths", async () => {
    const result = await callMcpTool("filesystem", "list_workspace_paths", {});
    expect(result.success).toBe(true);
    expect(result.text).toContain("/mnt/data");
  });

  it("unknown server fails clearly", async () => {
    const result = await callMcpTool("no-such-server", "x", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown MCP server/i);
  });
});

describe("formatMcpCallResult", () => {
  it("formats text content and errors", () => {
    expect(
      formatMcpCallResult({
        content: [{ type: "text", text: "hello" }],
      })
    ).toBe("hello");
    expect(
      formatMcpCallResult({
        content: [{ type: "text", text: "boom" }],
        isError: true,
      })
    ).toMatch(/^MCP error:/);
  });
});

describe("zero-key set", () => {
  it("includes in-process free servers", () => {
    const z = listZeroKeyMcpServers().map((s) => s.id);
    expect(z).toEqual(expect.arrayContaining(["time", "fetch", "git"]));
  });
});
