-- Run in the Supabase SQL Editor. Safe to re-run.

-- Allow a 'canceled' order status plus the reason/when columns.
alter table wholesale_orders drop constraint if exists wholesale_orders_order_status_check;
alter table wholesale_orders add constraint wholesale_orders_order_status_check
  check (order_status in ('pending', 'confirmed', 'fulfilled', 'canceled'));

alter table wholesale_orders add column if not exists cancel_reason text;
alter table wholesale_orders add column if not exists canceled_at timestamptz;
