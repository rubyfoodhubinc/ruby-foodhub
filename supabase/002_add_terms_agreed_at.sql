-- Run this in the Supabase SQL Editor if your orders table already exists
-- (i.e. you already ran schema.sql before this file was added). Safe to
-- run even if the column is already there — "if not exists" makes it a no-op.
alter table orders add column if not exists terms_agreed_at timestamptz;
