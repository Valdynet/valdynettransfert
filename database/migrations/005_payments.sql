-- Valdynet Transfert – Phase 5 (payments). Run after 001–004.
-- All payment writes go through the SQL functions below, callable ONLY by the service role
-- (Netlify Functions), after the function has authenticated the caller and verified ownership/role.

alter table public.payments
  add column provider_order_id text,
  add column proof_path text,
  add column reviewed_by uuid references public.profiles(id),
  add column review_note text check (review_note is null or char_length(review_note) <= 500),
  add column updated_at timestamptz not null default now();
create trigger trg_payments_updated before update on public.payments for each row execute function public.set_updated_at();

create unique index payments_order_key on public.payments (provider, provider_order_id) where provider_order_id is not null;
-- A provider transaction ID can be used once per provider, whatever its letter case.
create unique index payments_txid_ci_key on public.payments (provider, lower(btrim(provider_transaction_id))) where provider_transaction_id is not null;
-- One live payment per transaction: blocks double payment and double processing.
create unique index payments_one_active on public.payments (transaction_id) where status in ('pending','pending_verification','completed');

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (provider, event_id)                       -- a webhook event is processed once
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;

create table public.payment_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  wise_instructions text not null default '' check (char_length(wise_instructions) <= 2000),
  moncash_number text not null default '+50946345877' check (char_length(moncash_number) <= 30),
  natcash_number text not null default '+50955411690' check (char_length(natcash_number) <= 30),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.payment_settings default values;
create trigger trg_paysettings_updated before update on public.payment_settings for each row execute function public.set_updated_at();
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from anon, authenticated;

-- Private bucket for payment proofs: no storage policies => only the service role can read or sign access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

-- Internal: validated status change (same transition table as the admin screen).
create function public._set_tx_status(p_tx uuid, p_new text, p_actor uuid, p_desc text) returns void
language plpgsql security definer set search_path = public as
$$
declare v_old text;
begin
  select t.status into v_old from public.transactions t where t.id = p_tx for update;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  if v_old = p_new then return; end if;
  if not ((public.allowed_transitions() -> v_old) ? p_new) then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  update public.transactions set status = p_new where id = p_tx;
  insert into public.transaction_logs (transaction_id, actor_id, previous_status, new_status, action, description)
  values (p_tx, p_actor, v_old, p_new, 'status_changed', left(p_desc, 500));
end
$$;

create function public.record_paypal_order(p_tx uuid, p_order text) returns uuid
language plpgsql security definer set search_path = public as
$$
declare v_t record; v_id uuid;
begin
  select t.status, t.payment_method, t.total_amount, t.sender_currency into v_t from public.transactions t where t.id = p_tx;
  if not found or v_t.payment_method <> 'paypal' or v_t.status <> 'pending' then raise exception 'NOT_ALLOWED'; end if;
  begin
    insert into public.payments (transaction_id, provider, provider_order_id, amount, currency, status)
    values (p_tx, 'paypal', p_order, v_t.total_amount, v_t.sender_currency, 'pending') returning id into v_id;
  exception when unique_violation then raise exception 'PAYMENT_ALREADY_ACTIVE';
  end;
  return v_id;
end
$$;

-- Idempotent: a second call for the same order returns 'already' and changes nothing.
create function public.complete_paypal_payment(p_order text, p_capture text, p_amount numeric, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$
declare v_p record;
begin
  select * into v_p from public.payments where provider = 'paypal' and provider_order_id = p_order for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_p.status = 'completed' then return 'already'; end if;
  if v_p.amount <> p_amount or v_p.currency <> p_currency then raise exception 'AMOUNT_MISMATCH'; end if;
  update public.payments set status = 'completed', provider_transaction_id = p_capture, verified_at = now() where id = v_p.id;
  perform public._set_tx_status(v_p.transaction_id, 'payment_received', null, 'PayPal capture ' || p_capture);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'payment.paypal_completed', 'payment', v_p.id, jsonb_build_object('capture', p_capture));
  return 'completed';
end
$$;

-- p_status: failed | cancelled | refunded
create function public.mark_paypal_payment(p_order text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$
declare v_p record;
begin
  if p_status not in ('failed','cancelled','refunded') then raise exception 'INVALID_STATUS'; end if;
  select * into v_p from public.payments where provider = 'paypal' and provider_order_id = p_order for update;
  if not found then return; end if;
  if p_status = 'refunded' then
    if v_p.status <> 'completed' then return; end if;
    update public.payments set status = 'refunded' where id = v_p.id;
    perform public._set_tx_status(v_p.transaction_id, 'refunded', null, coalesce(p_note, 'PayPal refund'));
  elsif v_p.status in ('pending','pending_verification') then
    update public.payments set status = p_status where id = v_p.id;
  else
    return;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'payment.paypal_' || p_status, 'payment', v_p.id, jsonb_build_object('note', p_note));
end
$$;

create function public.submit_manual_payment(p_profile uuid, p_ref text, p_txid text, p_payref text, p_proof text) returns uuid
language plpgsql security definer set search_path = public as
$$
declare v_t record; v_id uuid;
begin
  select t.id, t.status, t.payment_method, t.total_amount, t.sender_currency into v_t
    from public.transactions t join public.customers c on c.id = t.customer_id
   where t.transaction_reference = p_ref and c.profile_id = p_profile for update of t;
  if not found or v_t.payment_method not in ('wise','moncash','natcash') or v_t.status <> 'pending' then raise exception 'NOT_ALLOWED'; end if;
  if p_proof is not null and p_proof not like (v_t.id::text || '/%') then raise exception 'INVALID_PROOF'; end if;
  begin
    insert into public.payments (transaction_id, provider, provider_transaction_id, amount, currency, status, payment_reference, proof_path)
    values (v_t.id, v_t.payment_method, btrim(p_txid), v_t.total_amount, v_t.sender_currency, 'pending_verification', btrim(p_payref), p_proof)
    returning id into v_id;
  exception when unique_violation then raise exception 'REFERENCE_ALREADY_USED';
  end;
  perform public._set_tx_status(v_t.id, 'pending_verification', p_profile, 'Manual payment submitted');
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_profile, 'payment.manual_submitted', 'payment', v_id, jsonb_build_object('provider', v_t.payment_method));
  return v_id;
end
$$;

create function public.admin_review_payment(p_payment uuid, p_actor uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as
$$
declare v_p record;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'NOT_ADMIN'; end if;
  select * into v_p from public.payments where id = p_payment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_p.status <> 'pending_verification' then raise exception 'NOT_PENDING_VERIFICATION'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'NOTE_REQUIRED'; end if;
  if p_approve then
    update public.payments set status = 'completed', verified_at = now(), reviewed_by = p_actor, review_note = left(p_note, 500) where id = p_payment;
    perform public._set_tx_status(v_p.transaction_id, 'payment_received', p_actor, coalesce(p_note, 'Payment approved'));
  else
    update public.payments set status = 'failed', reviewed_by = p_actor, review_note = left(p_note, 500) where id = p_payment;
    perform public._set_tx_status(v_p.transaction_id, 'rejected', p_actor, p_note);
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, case when p_approve then 'payment.approved' else 'payment.rejected' end, 'payment', p_payment, jsonb_build_object('note', p_note));
end
$$;

create function public.admin_update_payment_settings(p_actor uuid, p_wise text, p_moncash text, p_natcash text) returns void
language plpgsql security definer set search_path = public as
$$
declare v_old jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'NOT_ADMIN'; end if;
  select to_jsonb(s) - 'id' - 'singleton' into v_old from public.payment_settings s where s.singleton for update;
  update public.payment_settings set wise_instructions = p_wise, moncash_number = p_moncash, natcash_number = p_natcash, updated_by = p_actor where singleton;
  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (p_actor, 'payment_settings.updated', 'payment_settings', jsonb_build_object('before', v_old));
end
$$;

revoke all on function public._set_tx_status(uuid,text,uuid,text), public.record_paypal_order(uuid,text),
  public.complete_paypal_payment(text,text,numeric,text), public.mark_paypal_payment(text,text,text),
  public.submit_manual_payment(uuid,text,text,text,text), public.admin_review_payment(uuid,uuid,boolean,text),
  public.admin_update_payment_settings(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public._set_tx_status(uuid,text,uuid,text), public.record_paypal_order(uuid,text),
  public.complete_paypal_payment(text,text,numeric,text), public.mark_paypal_payment(text,text,text),
  public.submit_manual_payment(uuid,text,text,text,text), public.admin_review_payment(uuid,uuid,boolean,text),
  public.admin_update_payment_settings(uuid,text,text,text) to service_role;
