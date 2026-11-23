-- Valdynet Transfert – Row Level Security. Run after 001_schema.sql.
-- Model: browsers (anon key) can only READ their own data. Every financial write
-- (transactions, payments, settings, logs) goes through Netlify Functions using the service role.

create function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create function public.my_customer_id() returns uuid language sql stable security definer set search_path = public as
$$ select id from public.customers where profile_id = auth.uid() $$;

revoke all on function public.is_admin(), public.my_customer_id() from public;
grant execute on function public.is_admin(), public.my_customer_id() to authenticated;

alter table public.profiles           enable row level security;
alter table public.customers          enable row level security;
alter table public.transactions       enable row level security;
alter table public.payments           enable row level security;
alter table public.financial_settings enable row level security;
alter table public.transaction_logs   enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.notifications      enable row level security;

-- Table privileges: nothing for anon; read-only for signed-in users, plus two narrow updates.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.customers, public.transactions, public.payments,
  public.financial_settings, public.transaction_logs, public.audit_logs, public.notifications to authenticated;
grant update (first_name, last_name, phone, country) on public.profiles to authenticated;  -- NOT role, email, id
grant update (read_at) on public.notifications to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy customers_select on public.customers for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy transactions_select on public.transactions for select to authenticated
  using (customer_id = public.my_customer_id() or public.is_admin());

create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or transaction_id in
    (select id from public.transactions where customer_id = public.my_customer_id()));

create policy txlogs_select on public.transaction_logs for select to authenticated
  using (public.is_admin() or transaction_id in
    (select id from public.transactions where customer_id = public.my_customer_id()));

create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin());
create policy settings_select on public.financial_settings for select to authenticated using (public.is_admin());

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- First administrator (run manually in the SQL Editor after that person has signed up):
--   update public.profiles set role = 'admin' where lower(email) = lower('admin@example.com');
