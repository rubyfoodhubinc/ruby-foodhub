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
