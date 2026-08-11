# Klaw free / public MCP registry

Klaw integrates a **curated set of free, publicly usable MCP servers** (open-source, no paid lock-in for core tools).

Runtime registry + bridge live in code:

- `packages/agent-core/mcp/registry.ts` — curated catalog
- `packages/agent-core/mcp/bridge.ts` — list/call APIs
- `packages/agent-core/mcp/inprocess.ts` — zero-key in-process Time / Sequential Thinking / Echo

## Curated free servers

| id | kind | keys | run |
|----|------|------|-----|
| `time` | in-process | none | built-in |
| `sequential-thinking` | in-process | none | built-in |
| `echo` | in-process | none | bridge smoke |
| `fetch` | stdio | none | `npx -y @modelcontextprotocol/server-fetch` |
| `filesystem` | stdio | none | `npx -y @modelcontextprotocol/server-filesystem <root>` |
| `memory` | stdio | none | `npx -y @modelcontextprotocol/server-memory` |
| `github` | stdio | optional free PAT | `npx -y @modelcontextprotocol/server-github` |

Sources: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) (MIT).

## Agent tools

- `mcp_list_servers` — describe registry
- `mcp_list_tools` — list tools for a server id
- `mcp_call_tool` — invoke `{ server_id, tool_name, arguments }`

Example:

```json
{
  "server_id": "time",
  "tool_name": "get_current_time",
  "arguments": { "timezone": "UTC" }
}
```

## Notes

- In-process servers are always available (gating path).
- stdio servers need network + `npx`; failures are surfaced honestly.
- GitHub MCP is free-tier optional (PAT), not required for core demos.
