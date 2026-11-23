-- ============================================================
-- VALDYNET TRANSFERT — supabase.sql PRODUCTION
-- Kopye tout sa a epi kouri nan SQL Editor Supabase ou
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUMS ─────────────────────────────────────────────────
CREATE TYPE order_status AS ENUM (
  'Created', 'Waiting for Payment', 'Payment Received',
  'Pending Verification', 'Processing', 'Completed',
  'Cancelled', 'Refunded'
);

CREATE TYPE payment_status_enum AS ENUM (
  'Pending', 'Confirmed', 'Failed', 'Refunded'
);

-- ── CUSTOMERS ─────────────────────────────────────────────
CREATE TABLE customers (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name  TEXT        NOT NULL CHECK (char_length(full_name) >= 2),
  email      TEXT        NOT NULL CHECK (email ~* '^[^@\s]+\@[^@\s]+\.[^@\s]+$'),
  whatsapp   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_customers_email   ON customers (lower(email));
CREATE INDEX        idx_customers_created ON customers (created_at DESC);

-- ── ORDERS ────────────────────────────────────────────────
CREATE TABLE orders (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_number     TEXT          NOT NULL UNIQUE,
  customer_id            UUID          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  service                TEXT          NOT NULL,
  destination_account    TEXT          NOT NULL,
  payment_method         TEXT          NOT NULL,
  payment_transaction_id TEXT,
  amount                 NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee                    NUMERIC(14,2) NOT NULL CHECK (fee >= 0),
  total                  NUMERIC(14,2) NOT NULL CHECK (total > 0),
  currency               TEXT          NOT NULL DEFAULT 'USD',
  status                 order_status  NOT NULL DEFAULT 'Created',
  notes                  TEXT,
  customer_email_sent    BOOLEAN       NOT NULL DEFAULT FALSE,
  admin_email_sent       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status   ON orders (status);
CREATE INDEX idx_orders_created  ON orders (created_at DESC);
CREATE INDEX idx_orders_txn      ON orders (transaction_number);
CREATE INDEX idx_orders_method   ON orders (payment_method);

-- ── PAYMENTS ──────────────────────────────────────────────
CREATE TABLE payments (
  id                   UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id             UUID                NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider             TEXT                NOT NULL,
  provider_transaction TEXT,
  amount               NUMERIC(14,2)       NOT NULL CHECK (amount > 0),
  currency             TEXT                NOT NULL DEFAULT 'USD',
  payment_status       payment_status_enum NOT NULL DEFAULT 'Pending',
  created_at           TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_payments_provider_txn ON payments (provider_transaction)
  WHERE provider_transaction IS NOT NULL;
CREATE INDEX idx_payments_order  ON payments (order_id);
CREATE INDEX idx_payments_status ON payments (payment_status);

-- ── ADMIN LOGS ────────────────────────────────────────────
CREATE TABLE admin_logs (
  id         BIGSERIAL   PRIMARY KEY,
  action     TEXT        NOT NULL,
  admin      TEXT        NOT NULL DEFAULT 'system',
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_logs_created ON admin_logs (created_at DESC);
CREATE INDEX idx_admin_logs_action  ON admin_logs (action);

-- ── SEQUENCE TRANSACTION NUMBER ───────────────────────────
CREATE SEQUENCE order_seq START 1 INCREMENT 1 NO CYCLE;

-- ── FUNCTIONS ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_transaction_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  prefix    TEXT;
  seq_val   BIGINT;
  candidate TEXT;
BEGIN
  prefix    := 'VDT-' || TO_CHAR(NOW(), 'YYYY') || '-';
  seq_val   := NEXTVAL('order_seq');
  candidate := prefix || LPAD(seq_val::TEXT, 6, '0');

  WHILE EXISTS (SELECT 1 FROM orders WHERE transaction_number = candidate) LOOP
    seq_val   := NEXTVAL('order_seq');
    candidate := prefix || LPAD(seq_val::TEXT, 6, '0');
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION get_order_status(p_txn TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'transaction_number', o.transaction_number,
    'service',            o.service,
    'status',             o.status,
    'amount',             o.amount,
    'fee',                o.fee,
    'total',              o.total,
    'currency',           o.currency,
    'created_at',         o.created_at,
    'updated_at',         o.updated_at
  )
  INTO result
  FROM orders o
  WHERE o.transaction_number = p_txn;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_orders',         COUNT(*),
    'total_customers',      (SELECT COUNT(*) FROM customers),
    'total_revenue',        COALESCE(SUM(total), 0),
    'total_fees',           COALESCE(SUM(fee), 0),
    'completed_orders',     COUNT(*) FILTER (WHERE status = 'Completed'),
    'pending_verification', COUNT(*) FILTER (WHERE status = 'Pending Verification'),
    'payment_received',     COUNT(*) FILTER (WHERE status = 'Payment Received'),
    'processing_orders',    COUNT(*) FILTER (WHERE status = 'Processing'),
    'cancelled_orders',     COUNT(*) FILTER (WHERE status = 'Cancelled'),
    'refunded_orders',      COUNT(*) FILTER (WHERE status = 'Refunded')
  )
  INTO result
  FROM orders;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION get_today_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'today_orders',    COUNT(*),
    'today_revenue',   COALESCE(SUM(total), 0),
    'today_completed', COUNT(*) FILTER (WHERE status = 'Completed'),
    'today_pending',   COUNT(*) FILTER (WHERE status IN (
      'Pending Verification', 'Payment Received', 'Processing'
    ))
  )
  INTO result
  FROM orders
  WHERE created_at::DATE = CURRENT_DATE;

  RETURN result;
END;
$$;

-- ── ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE customers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_insert_customers
  ON customers FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY service_role_all_customers
  ON customers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY anon_insert_orders
  ON orders FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY service_role_all_orders
  ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY anon_insert_payments
  ON payments FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY service_role_all_payments
  ON payments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_role_all_logs
  ON admin_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
