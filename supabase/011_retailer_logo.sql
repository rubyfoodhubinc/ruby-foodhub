-- Run in the Supabase SQL Editor. Safe to re-run.
alter table retailer_accounts add column if not exists logo_url text;
