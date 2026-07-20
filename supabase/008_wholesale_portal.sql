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
