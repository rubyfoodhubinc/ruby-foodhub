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
  created_at timestamptz not null default now()
);

create index if not exists orders_order_date_idx on orders (order_date desc);

-- Row Level Security is on by default for new Supabase projects; no policies
-- are added here because this table is only ever accessed from serverless
-- functions using the service role key, which bypasses RLS entirely.
alter table orders enable row level security;
