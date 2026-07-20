-- Run in the Supabase SQL Editor. Safe to re-run.

-- Named admin accounts replacing the single shared ADMIN_PASSWORD.
-- Passwords are stored as bcrypt hashes only, never plaintext.
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'manager' check (role in ('owner', 'manager')),
  created_at timestamptz not null default now()
);

-- Server-side sessions: the browser only ever holds a random token,
-- never a password. Deleting a row revokes that session immediately.
create table if not exists admin_sessions (
  token text primary key,
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Who did what, when. admin_user_id is null for system actions
-- (webhook emails/saves, scheduled reconciliation runs).
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references admin_users(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on audit_log (created_at desc);

-- All three tables are service-role only: RLS on, zero policies.
alter table admin_users enable row level security;
alter table admin_sessions enable row level security;
alter table audit_log enable row level security;
