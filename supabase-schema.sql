-- ── Members Table ──────────────────────────────────────────────────────────
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

-- ── Dashboard Content Storage ────────────────────────────────────────────────
-- Supports: write (old paper), code (blank), action_theatre (theatre script), action_anime (anime notebook)
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

-- ── Daily Activity Feed ──────────────────────────────────────────────────────
create table if not exists public.wca_activities (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  name       text not null default '',
  action     text not null,
  details    text not null default '',
  timestamp  timestamptz not null default now()
);

alter table public.wca_activities enable row level security;
