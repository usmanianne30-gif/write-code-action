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
