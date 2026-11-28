-- Valdynet Transfert – Phase 6 (notifications). Run after 001–005.
-- Every transaction status change writes an in-app notification (customer, and admins for manual payments to verify).
-- A scheduled function (send-notifications) e-mails them. Account e-mails (confirmation, password reset) are sent by Supabase Auth.

alter table public.notifications
  add column transaction_id uuid references public.transactions(id),
  add column emailed_at timestamptz,
  add column email_attempts int not null default 0,
  add column email_error text,
  add column locked_at timestamptz;
create index notifications_unsent_idx on public.notifications (created_at) where emailed_at is null;

create function public.notify_on_tx_log() returns trigger language plpgsql security definer set search_path = public as
$$
declare v_t record; v_type text; v_title text; v_msg text;
begin
  select t.transaction_reference as ref, c.profile_id as pid into v_t
    from public.transactions t join public.customers c on c.id = t.customer_id where t.id = new.transaction_id;
  if not found then return new; end if;

  -- Customer messages (internal admin notes are never included).
  case
    when new.action = 'created' then
      v_type := 'transaction_created'; v_title := 'Transaction créée';
      v_msg := 'Votre transaction ' || v_t.ref || ' a été créée. Effectuez le paiement pour la poursuivre.';
    when new.new_status = 'pending_verification' then
      v_type := 'manual_payment_submitted'; v_title := 'Paiement soumis';
      v_msg := 'Nous vérifions votre paiement pour la transaction ' || v_t.ref || '.';
    when new.new_status = 'payment_received' then
      v_type := 'payment_received'; v_title := 'Paiement reçu';
      v_msg := 'Votre paiement pour la transaction ' || v_t.ref || ' est confirmé.';
    when new.new_status = 'processing' then
      v_type := 'transaction_processing'; v_title := 'Transaction en traitement';
      v_msg := 'Votre transaction ' || v_t.ref || ' est en cours de traitement.';
    when new.new_status = 'completed' then
      v_type := 'transaction_completed'; v_title := 'Transaction terminée';
      v_msg := 'Votre transaction ' || v_t.ref || ' est terminée.';
    when new.new_status = 'rejected' then
      v_type := 'transaction_rejected'; v_title := 'Transaction rejetée';
      v_msg := 'Votre transaction ' || v_t.ref || ' a été rejetée. Contactez-nous pour plus d’informations.';
    when new.new_status = 'cancelled' then
      v_type := 'transaction_cancelled'; v_title := 'Transaction annulée';
      v_msg := 'Votre transaction ' || v_t.ref || ' a été annulée.';
    when new.new_status = 'refunded' then
      v_type := 'transaction_refunded'; v_title := 'Transaction remboursée';
      v_msg := 'Votre transaction ' || v_t.ref || ' a été remboursée.';
    else return new;
  end case;

  insert into public.notifications (user_id, type, title, message, transaction_id) values (v_t.pid, v_type, v_title, v_msg, new.transaction_id);

  if new.new_status = 'pending_verification' then   -- admin template
    insert into public.notifications (user_id, type, title, message, transaction_id)
    select p.id, 'admin_payment_to_verify', 'Paiement à vérifier', 'La transaction ' || v_t.ref || ' attend une vérification de paiement.', new.transaction_id
      from public.profiles p where p.role = 'admin';
  end if;
  return new;
end
$$;
create trigger trg_notify_tx_log after insert on public.transaction_logs for each row execute function public.notify_on_tx_log();

-- Claim a batch (safe against two dispatchers running at once), then report the outcome.
create function public.claim_email_notifications(p_limit int)
returns table (out_id uuid, out_email text, out_title text, out_message text, out_type text)
language plpgsql security definer set search_path = public as
$$
begin
  return query
  with c as (
    select n.id from public.notifications n
     where n.emailed_at is null and n.email_attempts < 3 and n.created_at > now() - interval '24 hours'
       and (n.locked_at is null or n.locked_at < now() - interval '5 minutes')
     order by n.created_at limit p_limit for update skip locked)
  update public.notifications n set locked_at = now(), email_attempts = n.email_attempts + 1
    from c, public.profiles p where n.id = c.id and p.id = n.user_id
  returning n.id, p.email, n.title, n.message, n.type;
end
$$;

create function public.finish_email_notification(p_id uuid, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public as
$$ update public.notifications set emailed_at = case when p_ok then now() end,
     email_error = case when p_ok then null else left(p_error, 300) end, locked_at = null where id = p_id $$;

revoke all on function public.notify_on_tx_log(), public.claim_email_notifications(int),
  public.finish_email_notification(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(int), public.finish_email_notification(uuid,boolean,text) to service_role;
