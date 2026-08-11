-- Supabase Schema for Klaw (Agentic Platform)

create extension if not exists "uuid-ossp";

create table if not exists workspaces (
  id uuid default uuid_generate_v4() primary key,
  slack_team_id text unique not null,
  slack_team_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists threads (
  id uuid default uuid_generate_v4() primary key,
  workspace_id uuid references workspaces(id) not null,
  slack_channel text,
  slack_thread_ts text,
  status text default 'active',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Lookup Slack conversations without stuffing thread_ts into the UUID PK
create unique index if not exists threads_workspace_channel_ts_uidx
  on threads (workspace_id, slack_channel, slack_thread_ts);

create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  role text not null, -- 'user' | 'assistant' | 'system'
  content text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists messages_thread_id_created_at_idx
  on messages (thread_id, created_at);

create table if not exists artifacts (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  type text not null, -- 'pdf' | 'docx' | 'csv' | 'code' | 'image'
  file_path text, -- Supabase Storage URL
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists agent_runs (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  trigger text, -- 'slack' | 'web' | 'cron'
  status text default 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  steps jsonb, -- For the "Time-Travel" timeline
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Live timeline UI (Phase 6)
create table if not exists agent_logs (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  step_name text not null,
  status text default 'running', -- 'running' | 'completed' | 'failed'
  detail text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists agent_logs_thread_id_created_at_idx
  on agent_logs (thread_id, created_at);

-- Phase 7: Human-in-the-loop approvals
create table if not exists approvals (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  tool_call_id text not null,
  code_preview text,
  status text default 'pending', -- 'pending' | 'approved' | 'denied'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists approvals_tool_call_id_idx on approvals (tool_call_id);
create index if not exists approvals_thread_id_idx on approvals (thread_id);

-- Phase 7: Workspace guardrails (workspace_key = slack_team_id or 'web')
create table if not exists constraints (
  id uuid default uuid_generate_v4() primary key,
  workspace_id text not null,
  rule text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists constraints_workspace_id_idx on constraints (workspace_id);

-- Enable RLS
alter table agent_logs enable row level security;
alter table messages enable row level security;
alter table threads enable row level security;
alter table artifacts enable row level security;
alter table agent_runs enable row level security;
alter table workspaces enable row level security;
alter table approvals enable row level security;
alter table constraints enable row level security;

-- MVP open policies (tighten with auth later)
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_agent_logs') then
    create policy "mvp_all_agent_logs" on agent_logs for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_messages') then
    create policy "mvp_all_messages" on messages for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_threads') then
    create policy "mvp_all_threads" on threads for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_artifacts') then
    create policy "mvp_all_artifacts" on artifacts for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_agent_runs') then
    create policy "mvp_all_agent_runs" on agent_runs for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_workspaces') then
    create policy "mvp_all_workspaces" on workspaces for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_approvals') then
    create policy "mvp_all_approvals" on approvals for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'mvp_all_constraints') then
    create policy "mvp_all_constraints" on constraints for all using (true) with check (true);
  end if;
end $$;
