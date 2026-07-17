-- Run this in the Supabase SQL Editor for the already-live orders table.
-- Safe to run even if the columns already exist.
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount numeric(10, 2);
