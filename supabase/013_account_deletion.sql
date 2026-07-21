-- Run in the Supabase SQL Editor. Safe to re-run.

-- Self-service account deletion (required by Apple App Store guideline
-- 5.1.1(v) for any app offering account creation).
--
-- Deleting a retailer account ANONYMIZES it rather than dropping the row:
-- wholesale_orders.retailer_id is a NOT NULL foreign key, and those order
-- records must be retained for accounting and tax purposes. All personal
-- data (business name, contact name, email, phone, address, logo) is
-- wiped, the password is scrambled, sessions are revoked, and the account
-- can never be signed into again. This is disclosed in the privacy policy.
alter table retailer_accounts drop constraint if exists retailer_accounts_account_status_check;
alter table retailer_accounts add constraint retailer_accounts_account_status_check
  check (account_status in ('active', 'pending', 'suspended', 'closed'));

alter table retailer_accounts add column if not exists deleted_at timestamptz;
