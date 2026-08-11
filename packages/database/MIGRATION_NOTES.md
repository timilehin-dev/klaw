# Schema migration notes (Phase 10)

## What changed
- Added workspace-scoped RLS via `public.klaw_workspace_key()`.
- Removed open-all MVP policies (`mvp_all_*` / `Allow all for MVP`).
- Sensitive tables (`threads`, `messages`, `artifacts`, `agent_runs`, `agent_logs`, `approvals`, `workspaces`, memory, scheduled_tasks) are now scoped by workspace.

## Caller contract
- **Service role** (server/Inngest/agent): bypasses RLS — used by `/api/*` routes and `@klaw/core` server paths.
- **Anon/authenticated browser**: must set workspace key, e.g.
  ```sql
  select set_config('app.workspace_id', 'web', true);
  ```
  or JWT claim `workspace_id` / `slack_team_id`.
- Dashboard reads go through **service-role APIs** (`GET /api/threads`, `GET /api/threads/:id`) so the UI works without exposing the service key.

## Apply
Run `packages/database/schema.sql` in the Supabase SQL editor (or migrate tooling).
