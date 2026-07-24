-- 015: view-only admin role.
-- 'viewer' can sign in and read every admin screen but every mutating API
-- action rejects it server-side. Built for App Store reviewer access, useful
-- for any read-only stakeholder later.
alter table admin_users drop constraint if exists admin_users_role_check;
alter table admin_users
  add constraint admin_users_role_check check (role in ('owner', 'manager', 'viewer'));
