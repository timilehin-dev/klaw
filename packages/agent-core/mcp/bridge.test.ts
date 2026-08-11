import { describe, expect, it } from "vitest";
import {
  callMcpTool,
  describeFreeMcpRegistry,
  listMcpTools,
} from "./bridge";
import {
  FREE_MCP_REGISTRY,
  getMcpServer,
  listZeroKeyMcpServers,
} from "./registry";
import { formatMcpCallResult } from "./inprocess";

describe("free MCP registry", () => {
  it("includes zero-key free servers with docs", () => {
    const free = listZeroKeyMcpServers();
    expect(free.length).toBeGreaterThanOrEqual(3);
    expect(getMcpServer("time")).toBeTruthy();
    expect(getMcpServer("sequential-thinking")).toBeTruthy();
    expect(getMcpServer("echo")).toBeTruthy();
    const doc = describeFreeMcpRegistry();
    expect(doc).toContain("time");
    expect(doc).toContain("Free:");
  });

  it("marks github as optional free PAT not required", () => {
    const gh = getMcpServer("github");
    expect(gh?.optionalEnv).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(gh?.requiredEnv || []).toHaveLength(0);
  });
});

describe("MCP bridge list + call (in-process free servers)", () => {
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
    expect(result.error).toBeUndefined();
    expect(result.text).toMatch(/UTC|datetime|formatted/i);
    // Must include an ISO-ish timestamp from real Date path
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
    expect(result.text).toContain("continue");
  });

  it("echo tool returns the message (real handler)", async () => {
    const msg = `klaw-mcp-${Date.now()}`;
    const result = await callMcpTool("echo", "echo", { message: msg });
    expect(result.success).toBe(true);
    expect(result.text).toBe(msg);
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

describe("registry completeness", () => {
  it("every entry has id name free kind", () => {
    for (const s of FREE_MCP_REGISTRY) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(typeof s.free).toBe("boolean");
      expect(["stdio", "inprocess"]).toContain(s.kind);
    }
  });
});
