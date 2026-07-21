-- Run in the Supabase SQL Editor. Safe to re-run.

-- Production batch tracking: an 8-character batch key (letters/digits)
-- entered by an admin whenever goods ship to a retailer — required on
-- admin-created delivered orders and when marking any order fulfilled.
-- Shown to both admin and retailer on the order.
alter table wholesale_orders add column if not exists production_batch text;
