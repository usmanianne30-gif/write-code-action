create table public.wca_members (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_-]{3,24}$'),
  password_hash text not null,
  salt text not null,
  password_fingerprint text not null unique,
  joined_at timestamptz not null default now()
);

alter table public.wca_members enable row level security;

-- The browser has no database permissions. The server uses Supabase's
-- service-role key, which bypasses RLS and must remain private in Render.

-- ── Dashboard content storage ────────────────────────────────────────────────
-- One row per (username, section). On conflict the row is updated in place
-- using Supabase's "resolution=merge-duplicates" Prefer header.

create table public.wca_content (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references public.wca_members(username) on delete cascade,
  section    text not null check (section in ('write', 'code', 'action')),
  body       text not null default '',
  language   text not null default 'plaintext',
  updated_at timestamptz not null default now()
);

-- Ensures one row per user per section; also used by the upsert merge.
create unique index wca_content_user_section on public.wca_content(username, section);

alter table public.wca_content enable row level security;

-- The server uses the service-role key (bypasses RLS). No browser access needed.
