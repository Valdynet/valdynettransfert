-- Valdynet Transfert – Phase 4. Run after 001–003.
-- Admin writes are atomic SQL functions callable ONLY by the service role (Netlify Function /api/admin),
-- which first verifies the caller's admin role on the server. The functions re-check the role as well.

alter table public.financial_settings
  add column provider_fees jsonb not null default '{"paypal":null,"wise":null,"moncash":null,"natcash":null}'::jsonb
    check (jsonb_typeof(provider_fees) = 'object'),            -- flat fee per method, in that method's currency; null = "À confirmer"
  add column services_enabled jsonb not null default '{"deposit":true,"withdrawal":true,"wallet_transfer":false,"international":false}'::jsonb
    check (jsonb_typeof(services_enabled) = 'object'),
  add column methods_enabled jsonb not null default '{"paypal":true,"wise":true,"moncash":true,"natcash":true}'::jsonb
    check (jsonb_typeof(methods_enabled) = 'object');

-- Single source of truth for status changes (assumption to confirm with the owner).
create function public.allowed_transitions() returns jsonb language sql immutable as
$$ select '{
  "pending": ["pending_verification","payment_received","cancelled","rejected"],
  "pending_verification": ["payment_received","rejected","cancelled"],
  "payment_received": ["processing","refunded","cancelled"],
  "processing": ["completed","cancelled","refunded"],
  "completed": ["refunded"],
  "cancelled": [], "rejected": [], "refunded": []
}'::jsonb $$;

create function public.admin_change_status(p_tx uuid, p_actor uuid, p_new text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$
declare v_old text;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'NOT_ADMIN'; end if;
  select t.status into v_old from public.transactions t where t.id = p_tx for update;
  if v_old is null then raise exception 'NOT_FOUND'; end if;
  if not ((public.allowed_transitions() -> v_old) ? p_new) then raise exception 'TRANSITION_NOT_ALLOWED'; end if;
  if p_new in ('rejected','cancelled','refunded') and coalesce(btrim(p_note), '') = '' then raise exception 'NOTE_REQUIRED'; end if;

  update public.transactions set status = p_new where id = p_tx;
  insert into public.transaction_logs (transaction_id, actor_id, previous_status, new_status, action, description)
  values (p_tx, p_actor, v_old, p_new, 'status_changed', left(p_note, 500));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'transaction.status_changed', 'transaction', p_tx, jsonb_build_object('from', v_old, 'to', p_new));
end
$$;

create function public.admin_update_settings(p_actor uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as
$$
declare v_old jsonb; v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'NOT_ADMIN'; end if;
  select s.id, to_jsonb(s) - 'id' - 'singleton' into v_id, v_old from public.financial_settings s where s.singleton for update;
  update public.financial_settings set
    deposit_rate = coalesce((p_data->>'deposit_rate')::numeric, deposit_rate),
    withdrawal_rate = coalesce((p_data->>'withdrawal_rate')::numeric, withdrawal_rate),
    minimum_amount = coalesce((p_data->>'minimum_amount')::numeric, minimum_amount),
    low_fee_rate = coalesce((p_data->>'low_fee_rate')::numeric, low_fee_rate),
    high_fee_rate = coalesce((p_data->>'high_fee_rate')::numeric, high_fee_rate),
    fee_threshold = coalesce((p_data->>'fee_threshold')::numeric, fee_threshold),
    provider_fees = coalesce(p_data->'provider_fees', provider_fees),
    services_enabled = coalesce(p_data->'services_enabled', services_enabled),
    methods_enabled = coalesce(p_data->'methods_enabled', methods_enabled),
    updated_by = p_actor
  where singleton;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'settings.updated', 'financial_settings', v_id, jsonb_build_object('before', v_old, 'changes', p_data));
end
$$;

revoke all on function public.allowed_transitions(), public.admin_change_status(uuid,uuid,text,text),
  public.admin_update_settings(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.allowed_transitions(), public.admin_change_status(uuid,uuid,text,text),
  public.admin_update_settings(uuid,jsonb) to service_role;
