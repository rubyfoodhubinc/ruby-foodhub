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
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Retailer accounts (login is separate from admin and from customer accounts)
create table if not exists retailer_accounts (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  email text not null unique,
  password_hash text not null,
  phone text,
  address text,
  account_status text not null default 'pending'
    check (account_status in ('active', 'pending', 'suspended')),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- Server-side sessions: random token, 7-day expiry, revocable by row delete
create table if not exists retailer_sessions (
  token text primary key,
  retailer_id uuid not null references retailer_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Wholesale price per product/variant, linked to the products table by id
-- so a product rename can never orphan its wholesale price
create table if not exists wholesale_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references products(id) on delete cascade,
  wholesale_price numeric(10, 2) not null check (wholesale_price > 0),
  updated_at timestamptz not null default now()
);

-- Wholesale orders, fully separate from retail orders
create table if not exists wholesale_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  retailer_id uuid not null references retailer_accounts(id),
  items jsonb not null,
  total numeric(10, 2) not null,
  payment_method text not null check (payment_method in ('stripe', 'pay_on_delivery')),
  payment_status text not null default 'pending'
    check (payment_status in ('paid', 'pending', 'confirmed_by_admin')),
  order_status text not null default 'pending'
    check (order_status in ('pending', 'confirmed', 'fulfilled')),
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists wholesale_orders_retailer_idx on wholesale_orders (retailer_id, created_at desc);

-- Human-readable sequential order numbers (WHS-000001), assigned by a
-- BEFORE INSERT trigger so the not-null constraint is always satisfied.
create sequence if not exists wholesale_order_seq;

create or replace function set_wholesale_order_number() returns trigger as $$
begin
  if new.order_number is null then
    new.order_number := 'WHS-' || lpad(nextval('wholesale_order_seq')::text, 6, '0');
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists wholesale_order_number_trg on wholesale_orders;
create trigger wholesale_order_number_trg
  before insert on wholesale_orders
  for each row execute function set_wholesale_order_number();

-- All service-role only, same as every other table
alter table retailer_accounts enable row level security;
alter table retailer_sessions enable row level security;
alter table wholesale_prices enable row level security;
alter table wholesale_orders enable row level security;
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Allow a 'canceled' order status plus the reason/when columns.
alter table wholesale_orders drop constraint if exists wholesale_orders_order_status_check;
alter table wholesale_orders add constraint wholesale_orders_order_status_check
  check (order_status in ('pending', 'confirmed', 'fulfilled', 'canceled'));

alter table wholesale_orders add column if not exists cancel_reason text;
alter table wholesale_orders add column if not exists canceled_at timestamptz;
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Current on-hand quantity per retailer per product variant.
create table if not exists retailer_stock (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailer_accounts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (retailer_id, product_id)
);

-- Full movement ledger: every change, when, by whom (null = system,
-- e.g. auto stock-in when a wholesale order is fulfilled).
create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  retailer_id uuid not null references retailer_accounts(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  change integer not null,
  note text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_retailer_idx on stock_movements (retailer_id, created_at desc);

alter table retailer_stock enable row level security;
alter table stock_movements enable row level security;
-- Run in the Supabase SQL Editor. Safe to re-run.
alter table retailer_accounts add column if not exists logo_url text;
