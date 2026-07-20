-- Run this once in the Supabase Dashboard: Project -> SQL Editor -> New query.
-- order_id is the primary key (Ruby FoodHub order number, e.g. RFH0000000000007),
-- which also makes writes from the webhook idempotent via upsert — Stripe
-- can deliver the same checkout.session.completed event more than once.
create table if not exists orders (
  order_id text primary key,
  order_date timestamptz not null,
  customer_name text,
  email text,
  phone text,
  address text,
  zip text,
  shipping_tier text,
  notes text,
  items jsonb,
  subtotal numeric(10, 2),
  shipping numeric(10, 2),
  tip numeric(10, 2),
  total numeric(10, 2),
  terms_agreed_at timestamptz,
  coupon_code text,
  discount numeric(10, 2),
  order_status text not null default 'pending',
  customer_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists orders_order_date_idx on orders (order_date desc);

-- Row Level Security is on by default for new Supabase projects; no policies
-- are added here because this table is only ever accessed from serverless
-- functions using the service role key, which bypasses RLS entirely.
alter table orders enable row level security;
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
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Product catalog: prices now live here instead of being hardcoded in the
-- storefront pages. "active=false" is a soft delete — the variant vanishes
-- from the storefront but old orders keep their history.
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  variant text not null,
  price numeric(10, 2) not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, variant)
);

alter table products enable row level security;
-- Service-role only; the storefront reads via the /api/products endpoint.

-- Seed with the current live catalog (no-op if already present).
insert into products (slug, name, variant, price) values
  ('ginger-refresher', 'Ruby Ginger Refresher', '12oz Single', 9.99),
  ('ginger-refresher', 'Ruby Ginger Refresher', '6-Pack', 54.99),
  ('ginger-refresher', 'Ruby Ginger Refresher', '12-Pack', 108.99),
  ('ginger-refresher', 'Ruby Ginger Refresher', '24-Case', 215.99),
  ('sorrel-hibiscus-punch', 'Ruby Sorrel Hibiscus Punch', '12oz Single', 9.99),
  ('sorrel-hibiscus-punch', 'Ruby Sorrel Hibiscus Punch', '6-Pack', 54.99),
  ('sorrel-hibiscus-punch', 'Ruby Sorrel Hibiscus Punch', '12-Pack', 108.99),
  ('sorrel-hibiscus-punch', 'Ruby Sorrel Hibiscus Punch', '24-Case', 215.99)
on conflict (slug, variant) do nothing;

-- Admin account management extras.
alter table admin_users add column if not exists active boolean not null default true;
alter table admin_users add column if not exists last_login_at timestamptz;
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
