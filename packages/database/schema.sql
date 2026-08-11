-- Supabase Schema for Klaw (Agentic Platform)

create extension if not exists "uuid-ossp";

create table workspaces (
  id uuid default uuid_generate_v4() primary key,
  slack_team_id text unique not null,
  slack_team_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table threads (
  id uuid default uuid_generate_v4() primary key,
  workspace_id uuid references workspaces(id) not null,
  slack_channel text,
  slack_thread_ts text,
  status text default 'active',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table messages (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  role text not null, -- 'user' | 'assistant' | 'system'
  content text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table artifacts (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  type text not null, -- 'pdf' | 'docx' | 'csv' | 'code' | 'image'
  file_path text, -- Supabase Storage URL
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table agent_runs (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references threads(id) not null,
  trigger text, -- 'slack' | 'web' | 'cron'
  status text default 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  steps jsonb, -- For the "Time-Travel" timeline
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
