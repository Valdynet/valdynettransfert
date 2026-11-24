-- Valdynet Transfert – Phase 3. Run after 001 and 002.
-- Adds recipient/idempotency columns, rate limiting, server-side reference generation
-- and an atomic create_transaction() used ONLY by Netlify Functions (service role).

alter table public.transactions
  add column idempotency_key uuid,
  add column recipient_name text check (recipient_name is null or char_length(recipient_name) <= 120),
  add column recipient_contact text check (recipient_contact is null or char_length(recipient_contact) <= 120),
  add column notes text check (notes is null or char_length(notes) <= 500);
create unique index transactions_idem_key on public.transactions (customer_id, idempotency_key) where idempotency_key is not null;

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);
alter table public.rate_limits enable row level security;   -- no policies: service role only
revoke all on public.rate_limits from anon, authenticated;
-- Housekeeping (optional, e.g. daily): delete from public.rate_limits where window_start < now() - interval '1 day';

create function public.check_rate_limit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as
$$
declare v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning r.hits into v_hits;
  return v_hits <= p_max;
end
$$;

-- Unguessable reference: VT- + 10 chars from a 31-symbol alphabet (no I, L, O, 0, 1).
create function public.gen_transaction_reference() returns text language plpgsql volatile as
$$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(10);
  ref text := 'VT-';
  i int;
begin
  for i in 0..9 loop
    ref := ref || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return ref;
end
$$;

-- p_calc is the output of the backend finance service (never the browser's numbers).
create function public.create_transaction(
  p_profile_id uuid, p_idem uuid, p_calc jsonb,
  p_recipient_name text, p_recipient_contact text, p_notes text)
returns table (out_reference text, out_status text, out_created boolean)
language plpgsql security definer set search_path = public as
$$
declare
  v_customer uuid; v_id uuid; v_ref text; v_status text; v_tries int := 0;
begin
  select c.id into v_customer from public.customers c
   where c.profile_id = p_profile_id and c.customer_status = 'active';
  if v_customer is null then raise exception 'CUSTOMER_UNAVAILABLE'; end if;

  -- Same idempotency key => return the transaction already created (duplicate submission).
  select t.id, t.transaction_reference, t.status into v_id, v_ref, v_status
    from public.transactions t where t.customer_id = v_customer and t.idempotency_key = p_idem;
  if found then return query select v_ref, v_status, false; return; end if;

  loop
    v_ref := public.gen_transaction_reference();
    begin
      insert into public.transactions (
        transaction_reference, customer_id, service_type, sender_amount, sender_currency, exchange_rate,
        converted_amount, service_fee, provider_fee, total_amount, recipient_amount, recipient_currency,
        payment_method, status, idempotency_key, recipient_name, recipient_contact, notes)
      values (
        v_ref, v_customer, p_calc->>'service', (p_calc->>'senderAmount')::numeric, p_calc->>'senderCurrency',
        (p_calc->>'exchangeRate')::numeric, (p_calc->>'convertedAmount')::numeric, (p_calc->>'serviceFee')::numeric,
        (p_calc->>'providerFee')::numeric, (p_calc->>'totalAmount')::numeric, (p_calc->>'recipientAmount')::numeric,
        p_calc->>'recipientCurrency', p_calc->>'method', 'pending', p_idem,
        p_recipient_name, p_recipient_contact, p_notes)
      returning id into v_id;
      exit;
    exception when unique_violation then
      select t.id, t.transaction_reference, t.status into v_id, v_ref, v_status
        from public.transactions t where t.customer_id = v_customer and t.idempotency_key = p_idem;
      if found then return query select v_ref, v_status, false; return; end if;
      v_tries := v_tries + 1;
      if v_tries > 5 then raise; end if;   -- reference collision: retry with a new one
    end;
  end loop;

  insert into public.transaction_logs (transaction_id, actor_id, new_status, action, description)
  values (v_id, p_profile_id, 'pending', 'created', 'Transaction created by customer');
  return query select v_ref, 'pending'::text, true;
end
$$;

revoke all on function public.check_rate_limit(text,int,int), public.gen_transaction_reference(),
  public.create_transaction(uuid,uuid,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text,int,int), public.gen_transaction_reference(),
  public.create_transaction(uuid,uuid,jsonb,text,text,text) to service_role;
