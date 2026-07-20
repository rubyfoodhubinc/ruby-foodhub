-- Run in the Supabase SQL Editor. Safe to re-run.

-- One row per promotional send (campaign or individual).
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  html text,
  source text not null, -- 'subscribers' | 'customers' | 'both' | 'manual' | 'individual'
  recipient_count integer,
  resend_broadcast_ids jsonb, -- broadcast id(s), for finding the send in Resend's dashboard
  sent_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_campaigns_created_at_idx on email_campaigns (created_at desc);

-- Reusable compose templates.
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  html text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Service-role only.
alter table email_campaigns enable row level security;
alter table email_templates enable row level security;
