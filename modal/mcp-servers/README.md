# Klaw MCP Ecosystem (16 servers)

Plug-and-play registry: `packages/agent-core/mcp/registry.ts`  
Router: `packages/agent-core/mcp/bridge.ts`  
Agent tools: `mcp_list_servers` · `mcp_list_tools` · `mcp_call_tool`

## Tier 1 — Self-hosted / free local

| # | id | Status | How it runs |
|---|-----|--------|-------------|
| 1 | `filesystem` | **native** | Modal sandbox `/mnt/data` + `execute_code` |
| 2 | `memory` | **native** | Supabase knowledge graph (Phase 9) |
| 3 | `playwright` | **native** | Modal browser sandbox |
| 4 | `tavily` | **native** | Tavily API (`web_search`) |
| 5 | `sequential-thinking` | **ready** | In-process + optional Modal HTTP |
| 6 | `git` | **ready** | In-process git CLI tools |
| 7 | `fetch` | **ready** | In-process fetch + optional Modal `fetch_mcp.py` |
| 8 | `time` | **ready** | In-process + optional Modal `time_mcp.py` |

### Deploy optional Modal HTTP wrappers

```bash
modal deploy modal/mcp-servers/fetch_mcp.py
modal deploy modal/mcp-servers/time_mcp.py
modal deploy modal/mcp-servers/sequential_thinking_mcp.py
```

Set env if you prefer Modal over in-process:

```env
MCP_FETCH_HTTP_URL=https://...
MCP_TIME_HTTP_URL=https://...
MCP_SEQUENTIAL_THINKING_HTTP_URL=https://...
```

## Tier 2 — Official remote MCPs (OAuth / free tiers)

| # | id | Status | Env |
|---|-----|--------|-----|
| 9 | `github` | optional | `GITHUB_PERSONAL_ACCESS_TOKEN`, `MCP_GITHUB_URL` |
| 10 | `supabase` | pending_oauth | `MCP_SUPABASE_URL` + project keys |
| 11 | `notion` | pending_oauth | `NOTION_API_KEY`, `MCP_NOTION_URL` |
| 12 | `linear` | pending_oauth | `LINEAR_API_KEY`, `MCP_LINEAR_URL` |
| 13 | `slack-mcp` | pending_oauth | `MCP_SLACK_URL` (Web API already native) |
| 14 | `sentry` | pending_oauth | `SENTRY_AUTH_TOKEN`, `MCP_SENTRY_URL` |
| 15 | `stripe` | pending_oauth | `STRIPE_SECRET_KEY`, `MCP_STRIPE_URL` |
| 16 | `context7` | optional | `CONTEXT7_API_KEY`, `MCP_CONTEXT7_URL` (default public MCP) |

When `MCP_*_URL` is set, the router calls Streamable HTTP / JSON tool endpoints.  
When unset, Tier 2 servers return configure guidance instead of crashing.

## Agent usage

```
mcp_list_servers
mcp_list_tools { "server_id": "time" }
mcp_call_tool  { "server_id": "time", "tool_name": "get_current_time", "arguments": { "timezone": "UTC" } }
mcp_call_tool  { "server_id": "fetch", "tool_name": "fetch", "arguments": { "url": "https://example.com" } }
mcp_call_tool  { "server_id": "git", "tool_name": "git_status", "arguments": {} }
```

## Architecture

```
Agent  →  mcp_call_tool
            → MCP Router (bridge.ts)
                 → native (filesystem/memory/playwright/tavily)
                 → inprocess (time/fetch/git/sequential-thinking)
                 → stdio (npx official packages)
                 → http/remote (Modal or vendor OAuth MCP)
```

Adding a 17th server = one registry entry + optional adapter. No agent-loop rewrite.
