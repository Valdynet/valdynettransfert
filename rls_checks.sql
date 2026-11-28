-- Row Level Security checks. Run in the Supabase SQL Editor after migrations 001–006.
-- Creates two throw-away customers, tests isolation, then ROLLS BACK (nothing is kept).
-- A failure stops with "FAIL ...". Success prints "ALL RLS CHECKS PASSED" in the messages panel.
-- If the insert into auth.users is refused, create two users in Authentication → Users and use their ids below.
begin;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rls-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'rls-b@test.local', 'authenticated', 'authenticated');
insert into public.transactions (transaction_reference, customer_id, service_type, sender_amount, sender_currency, exchange_rate,
  converted_amount, service_fee, total_amount, recipient_amount, recipient_currency, payment_method)
select 'VT-TEST' || right(c.profile_id::text, 1) || '0000', c.id, 'deposit', 50, 'USD', 140, 7000, 5, 55, 7000, 'HTG', 'paypal'
  from public.customers c where c.profile_id in ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002');

do $$
declare n int;
  a constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.profiles where email like 'rls-%@test.local';
  if n <> 1 then raise exception 'FAIL profiles isolation: saw % rows', n; end if;
  select count(*) into n from public.transactions where transaction_reference like 'VT-TEST%';
  if n <> 1 then raise exception 'FAIL transactions isolation: saw % rows', n; end if;
  select count(*) into n from public.transactions where transaction_reference = 'VT-TEST20000';
  if n <> 0 then raise exception 'FAIL customer A can read customer B''s transaction'; end if;
  select count(*) into n from public.financial_settings;
  if n <> 0 then raise exception 'FAIL financial settings visible to a customer'; end if;
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'FAIL audit logs visible to a customer'; end if;

  begin update public.profiles set role = 'admin' where id = a; raise exception 'FAIL customer changed own role';
  exception when insufficient_privilege then null; end;
  begin update public.transactions set status = 'completed'; raise exception 'FAIL customer changed a transaction status';
  exception when insufficient_privilege then null; end;
  begin insert into public.audit_logs (action, entity_type) values ('x', 'x'); raise exception 'FAIL customer wrote an audit log';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.payment_settings; raise exception 'FAIL payment settings readable by a customer';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_review_payment(gen_random_uuid(), a, true, null); raise exception 'FAIL customer called an admin function';
  exception when insufficient_privilege then null; end;

  execute 'reset role';
  execute 'set local role anon';
  begin perform 1 from public.transactions; raise exception 'FAIL anonymous read of transactions';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  raise notice 'ALL RLS CHECKS PASSED';
end
$$;
rollback;
