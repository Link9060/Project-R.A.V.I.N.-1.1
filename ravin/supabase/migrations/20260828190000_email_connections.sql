create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  category text not null default 'personal' check (category in ('personal', 'school')),
  email text not null,
  display_name text not null default '',
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scope text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email)
);

create index if not exists email_connections_user_id_idx
  on public.email_connections (user_id);

alter table public.email_connections enable row level security;

revoke all on table public.email_connections from anon, authenticated;
grant select, insert, update, delete on table public.email_connections to service_role;

comment on table public.email_connections is
  'Server-only Google and Microsoft mailbox connections. OAuth tokens are encrypted by the RAVIN backend before storage.';
