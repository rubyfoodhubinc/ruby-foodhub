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
