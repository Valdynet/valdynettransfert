-- Valdynet Transfert – Phase 2 schema. Run in Supabase SQL Editor, then run 002_rls.sql.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name  text not null default '' check (char_length(last_name) <= 80),
  email text not null,
  phone text check (phone is null or char_length(phone) <= 30),
  country text check (country is null or char_length(country) <= 60),
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  customer_status text not null default 'active' check (customer_status in ('active','suspended')),
  created_at timestamptz not null default now()
);

-- Financial records are never cascaded away: customer_id has no ON DELETE CASCADE.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_reference text not null unique,
  customer_id uuid not null references public.customers(id),
  service_type text not null check (service_type in ('deposit','withdrawal','wallet_transfer','international')),
  sender_amount numeric(14,2) not null check (sender_amount > 0),
  sender_currency text not null check (sender_currency in ('USD','HTG')),
  exchange_rate numeric(12,4) not null check (exchange_rate > 0),   -- rate frozen at creation
  converted_amount numeric(14,2) not null check (converted_amount >= 0),
  service_fee numeric(14,2) not null check (service_fee >= 0),
  provider_fee numeric(14,2) check (provider_fee is null or provider_fee >= 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  recipient_amount numeric(14,2) not null check (recipient_amount >= 0),
  recipient_currency text not null check (recipient_currency in ('USD','HTG')),
  payment_method text not null check (payment_method in ('paypal','wise','moncash','natcash')),
  status text not null default 'pending' check (status in
    ('pending','pending_verification','payment_received','processing','completed','cancelled','rejected','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_customer_idx on public.transactions (customer_id, created_at desc);
create index transactions_status_idx on public.transactions (status, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  provider text not null check (provider in ('paypal','wise','moncash','natcash')),
  provider_transaction_id text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('USD','HTG')),
  status text not null default 'pending' check (status in
    ('pending','pending_verification','completed','failed','cancelled','refunded')),
  payment_reference text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)   -- blocks duplicate captures / reused provider IDs
);
create index payments_transaction_idx on public.payments (transaction_id);

create table public.financial_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),   -- exactly one row
  deposit_rate numeric(12,4) not null default 140 check (deposit_rate > 0),
  withdrawal_rate numeric(12,4) not null default 130 check (withdrawal_rate > 0),
  minimum_amount numeric(14,2) not null default 10 check (minimum_amount > 0),
  low_fee_rate numeric(6,4) not null default 0.05 check (low_fee_rate between 0 and 1),
  high_fee_rate numeric(6,4) not null default 0.10 check (high_fee_rate between 0 and 1),
  fee_threshold numeric(14,2) not null default 30 check (fee_threshold > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.financial_settings default values;

create table public.transaction_logs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  actor_id uuid references public.profiles(id),
  previous_status text,
  new_status text,
  action text not null,
  description text,
  created_at timestamptz not null default now()
);
create index transaction_logs_tx_idx on public.transaction_logs (transaction_id, created_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- updated_at
create function public.set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_transactions_updated before update on public.transactions for each row execute function public.set_updated_at();
create trigger trg_settings_updated before update on public.financial_settings for each row execute function public.set_updated_at();

-- Logs are append-only for everyone, including the service role.
create function public.forbid_mutation() returns trigger language plpgsql as
$$ begin raise exception 'Table % is append-only', tg_table_name; end $$;
create trigger trg_txlogs_append_only before update or delete on public.transaction_logs for each row execute function public.forbid_mutation();
create trigger trg_audit_append_only before update or delete on public.audit_logs for each row execute function public.forbid_mutation();

-- New Auth user => profile + customer. The role is ALWAYS 'customer': browser metadata is never used for it.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, country)
  values (new.id, new.email,
    left(coalesce(new.raw_user_meta_data->>'first_name',''), 80),
    left(coalesce(new.raw_user_meta_data->>'last_name',''), 80),
    left(new.raw_user_meta_data->>'phone', 30),
    left(new.raw_user_meta_data->>'country', 60));
  insert into public.customers (profile_id) values (new.id);
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
