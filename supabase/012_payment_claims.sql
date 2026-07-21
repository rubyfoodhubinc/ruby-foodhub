-- Run in the Supabase SQL Editor. Safe to re-run.

-- Cash / Zelle payment claims: a retailer can report they've paid outside
-- Stripe. The order enters 'awaiting_confirmation' and STAYS owed until an
-- admin confirms (-> confirmed_by_admin) or rejects (-> back to pending).
alter table wholesale_orders drop constraint if exists wholesale_orders_payment_status_check;
alter table wholesale_orders add constraint wholesale_orders_payment_status_check
  check (payment_status in ('paid', 'pending', 'awaiting_confirmation', 'confirmed_by_admin'));

-- How the order was actually settled can now also be cash or zelle.
alter table wholesale_orders drop constraint if exists wholesale_orders_payment_method_check;
alter table wholesale_orders add constraint wholesale_orders_payment_method_check
  check (payment_method in ('stripe', 'pay_on_delivery', 'cash', 'zelle'));

-- What the retailer claims: method, when, and an optional reference
-- (e.g. a Zelle confirmation number).
alter table wholesale_orders add column if not exists claimed_payment_method text;
alter table wholesale_orders add column if not exists claimed_at timestamptz;
alter table wholesale_orders add column if not exists claimed_reference text;
