-- Run in the Supabase SQL Editor. Safe to re-run.

-- Order fulfillment status, manually controlled from /admin for now
-- (future: shipping-carrier API integration can update it).
-- The default backfills all existing rows as 'pending'.
alter table orders add column if not exists order_status text not null default 'pending';

-- Links an order to the signed-in customer who placed it (auth.users id).
-- Null for guest checkouts.
alter table orders add column if not exists customer_id uuid;

-- Customer profile, one row per registered account. The row id IS the
-- customer ID (same uuid as auth.users). Addresses: up to 3, enforced
-- in the application layer.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  addresses jsonb not null default '[]'::jsonb,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Customers can only ever see and edit their own profile.
drop policy if exists "own profile select" on profiles;
create policy "own profile select" on profiles for select using (auth.uid() = id);
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- Customers can read their own orders (needed for the account dashboard).
-- Writes remain service-role only: no insert/update policies are added.
drop policy if exists "own orders select" on orders;
create policy "own orders select" on orders for select using (auth.uid() = customer_id);
