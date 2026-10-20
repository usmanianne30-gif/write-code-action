-- =============================================================================
-- WRITE CODE ACTION (WCA) — DATABASE SCHEMA & COMPLETE RESET SCRIPT
-- =============================================================================
-- 1. TO WIPE ALL PRE-EXISTING DATA OF EVERY MEMBER (Requirement 1):
-- Run this block in your Supabase SQL Editor:
--
--   truncate table public.wca_works, public.wca_content, public.wca_activities, public.wca_members cascade;
--
-- =============================================================================

-- ── 1. Members Table ─────────────────────────────────────────────────────────
create table if not exists public.wca_members (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  username text not null unique check (username ~ '^[a-z0-9_-]{3,24}$'),
  password_hash text not null,
  salt text not null,
  password_fingerprint text not null unique,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

alter table public.wca_members enable row level security;

-- ── 2. Saved Works Archive (Multi-document support: Write, Code, Action) ─────
create table if not exists public.wca_works (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.wca_members(username) on delete cascade,
  section text not null check (section in ('write', 'code', 'action')),
  title text not null default 'Untitled',
  body text not null default '',
  language text not null default 'plaintext',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wca_works_user_section on public.wca_works(username, section);
create index if not exists wca_works_updated_at on public.wca_works(updated_at desc);

alter table public.wca_works enable row level security;

-- ── 3. Single-Slot Content Table (Backwards compatibility) ───────────────────
create table if not exists public.wca_content (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references public.wca_members(username) on delete cascade,
  section    text not null check (section in ('write', 'code', 'action', 'action_theatre', 'action_anime')),
  body       text not null default '',
  language   text not null default 'plaintext',
  updated_at timestamptz not null default now()
);

create unique index if not exists wca_content_user_section on public.wca_content(username, section);

alter table public.wca_content enable row level security;

-- ── 4. Daily Activity Feed ───────────────────────────────────────────────────
create table if not exists public.wca_activities (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  name       text not null default '',
  action     text not null,
  details    text not null default '',
  timestamp  timestamptz not null default now()
);

alter table public.wca_activities enable row level security;
