-- Supabase Schema for Klaw (Agentic Platform)

create extension if not exists "uuid-ossp";

create table if not exists workspaces (
  id uuid default uuid_generate_v4() primary key,
  slack_team_id text unique not null,
  slack_team_name text,
  slack_bot_token_encrypted text,
  slack_bot_user_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table workspaces add column if not exists slack_bot_token_encrypted text;
alter table workspaces add column if not exists slack_bot_user_id text;

create table if not exists threads (
  id uuid default uuid_generate_v4() primary key,
  workspace_id uuid references workspaces(id) not null,
  slack_channel text,
  slack_thread_ts text,
  status text default 'active',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists threads_workspace_channel_ts_uidx
  on threads (workspace_id, slack_channel, slack_thread_ts);

create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  role text not null,
  content text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists messages_thread_id_created_at_idx
  on messages (thread_id, created_at);

create table if not exists artifacts (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  type text not null,
  file_path text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists artifacts_thread_id_idx on artifacts (thread_id);

create table if not exists agent_runs (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  trigger text,
  status text default 'pending',
  steps jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists agent_runs_thread_id_idx on agent_runs (thread_id);

create table if not exists agent_logs (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  step_name text not null,
  status text default 'running',
  detail text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists agent_logs_thread_id_created_at_idx
  on agent_logs (thread_id, created_at);

create table if not exists approvals (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  tool_call_id text not null,
  code_preview text,
  status text default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists approvals_tool_call_id_idx on approvals (tool_call_id);
create index if not exists approvals_thread_id_idx on approvals (thread_id);

create table if not exists constraints (
  id uuid default uuid_generate_v4() primary key,
  workspace_id text not null,
  rule text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists constraints_workspace_id_idx on constraints (workspace_id);

create table if not exists memory_entities (
  id uuid default uuid_generate_v4() primary key,
  workspace_id text not null,
  name text not null,
  entity_type text not null,
  observations jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (workspace_id, name)
);

create table if not exists memory_relations (
  id uuid default uuid_generate_v4() primary key,
  workspace_id text not null,
  source_entity text not null,
  target_entity text not null,
  relation_type text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists memory_entities_workspace_idx on memory_entities (workspace_id);
create index if not exists memory_relations_workspace_idx on memory_relations (workspace_id);

create table if not exists scheduled_tasks (
  id uuid default uuid_generate_v4() primary key,
  workspace_id text not null,
  name text not null,
  cron_expression text not null,
  prompt text not null,
  slack_channel text,
  active boolean default true,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists scheduled_tasks_active_next_idx
  on scheduled_tasks (active, next_run_at);

-- ---------------------------------------------------------------------------
-- RLS: workspace-scoped policies (Phase 10)
-- Service role bypasses RLS. Anon/authenticated clients must set:
--   select set_config('app.workspace_id', '<slack_team_id or web>', true);
-- or use JWT claim request.jwt.claims ->> 'workspace_id'
-- ---------------------------------------------------------------------------
alter table agent_logs enable row level security;
alter table messages enable row level security;
alter table threads enable row level security;
alter table artifacts enable row level security;
alter table agent_runs enable row level security;
alter table workspaces enable row level security;
alter table approvals enable row level security;
alter table constraints enable row level security;
alter table memory_entities enable row level security;
alter table memory_relations enable row level security;
alter table scheduled_tasks enable row level security;

-- Helper: resolve caller's workspace text key (slack_team_id or 'web')
-- Prefer request setting app.workspace_id, else JWT claim, else deny.
create or replace function public.klaw_workspace_key()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.workspace_id', true), ''),
    nullif(auth.jwt() ->> 'workspace_id', ''),
    nullif(auth.jwt() ->> 'slack_team_id', '')
  );
$$;

-- Drop legacy open-all MVP policies if present
do $$
declare
  p text;
begin
  foreach p in array array[
    'mvp_all_agent_logs','mvp_all_messages','mvp_all_threads','mvp_all_artifacts',
    'mvp_all_agent_runs','mvp_all_workspaces','mvp_all_approvals','mvp_all_constraints',
    'mvp_all_memory_entities','mvp_all_memory_relations','mvp_all_scheduled_tasks',
    'Allow all for MVP'
  ]
  loop
    execute format('drop policy if exists %I on agent_logs', p);
    execute format('drop policy if exists %I on messages', p);
    execute format('drop policy if exists %I on threads', p);
    execute format('drop policy if exists %I on artifacts', p);
    execute format('drop policy if exists %I on agent_runs', p);
    execute format('drop policy if exists %I on workspaces', p);
    execute format('drop policy if exists %I on approvals', p);
    execute format('drop policy if exists %I on constraints', p);
    execute format('drop policy if exists %I on memory_entities', p);
    execute format('drop policy if exists %I on memory_relations', p);
    execute format('drop policy if exists %I on scheduled_tasks', p);
  end loop;
exception when others then
  null;
end $$;

-- Workspaces: row visible only when slack_team_id matches caller key
drop policy if exists ws_select_own on workspaces;
create policy ws_select_own on workspaces
  for select using (slack_team_id = public.klaw_workspace_key());

drop policy if exists ws_insert_own on workspaces;
create policy ws_insert_own on workspaces
  for insert with check (slack_team_id = public.klaw_workspace_key());

drop policy if exists ws_update_own on workspaces;
create policy ws_update_own on workspaces
  for update using (slack_team_id = public.klaw_workspace_key());

-- Threads: join via workspace
drop policy if exists threads_select_ws on threads;
create policy threads_select_ws on threads
  for select using (
    workspace_id in (
      select id from workspaces where slack_team_id = public.klaw_workspace_key()
    )
  );

drop policy if exists threads_insert_ws on threads;
create policy threads_insert_ws on threads
  for insert with check (
    workspace_id in (
      select id from workspaces where slack_team_id = public.klaw_workspace_key()
    )
  );

drop policy if exists threads_update_ws on threads;
create policy threads_update_ws on threads
  for update using (
    workspace_id in (
      select id from workspaces where slack_team_id = public.klaw_workspace_key()
    )
  );

-- Messages / artifacts / agent_runs / agent_logs / approvals: via thread → workspace
drop policy if exists messages_select_ws on messages;
create policy messages_select_ws on messages for select using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists messages_insert_ws on messages;
create policy messages_insert_ws on messages for insert with check (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);

drop policy if exists artifacts_select_ws on artifacts;
create policy artifacts_select_ws on artifacts for select using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists artifacts_insert_ws on artifacts;
create policy artifacts_insert_ws on artifacts for insert with check (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);

drop policy if exists agent_runs_select_ws on agent_runs;
create policy agent_runs_select_ws on agent_runs for select using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists agent_runs_insert_ws on agent_runs;
create policy agent_runs_insert_ws on agent_runs for insert with check (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists agent_runs_update_ws on agent_runs;
create policy agent_runs_update_ws on agent_runs for update using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);

drop policy if exists agent_logs_select_ws on agent_logs;
create policy agent_logs_select_ws on agent_logs for select using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists agent_logs_insert_ws on agent_logs;
create policy agent_logs_insert_ws on agent_logs for insert with check (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);

drop policy if exists approvals_select_ws on approvals;
create policy approvals_select_ws on approvals for select using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists approvals_insert_ws on approvals;
create policy approvals_insert_ws on approvals for insert with check (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);
drop policy if exists approvals_update_ws on approvals;
create policy approvals_update_ws on approvals for update using (
  thread_id in (
    select t.id from threads t
    join workspaces w on w.id = t.workspace_id
    where w.slack_team_id = public.klaw_workspace_key()
  )
);

-- Text-keyed tables: direct workspace_id match
drop policy if exists constraints_ws on constraints;
create policy constraints_ws on constraints for all
  using (workspace_id = public.klaw_workspace_key() or workspace_id = '*')
  with check (workspace_id = public.klaw_workspace_key() or workspace_id = '*');

drop policy if exists memory_entities_ws on memory_entities;
create policy memory_entities_ws on memory_entities for all
  using (workspace_id = public.klaw_workspace_key())
  with check (workspace_id = public.klaw_workspace_key());

drop policy if exists memory_relations_ws on memory_relations;
create policy memory_relations_ws on memory_relations for all
  using (workspace_id = public.klaw_workspace_key())
  with check (workspace_id = public.klaw_workspace_key());

drop policy if exists scheduled_tasks_ws on scheduled_tasks;
create policy scheduled_tasks_ws on scheduled_tasks for all
  using (workspace_id = public.klaw_workspace_key())
  with check (workspace_id = public.klaw_workspace_key());

-- Migration note:
-- Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses RLS for agent/server paths.
-- Browser clients using anon key must set workspace claim or use server APIs
-- (/api/threads, etc.) which already use service role.
