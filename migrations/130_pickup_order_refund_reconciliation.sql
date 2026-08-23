ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS stripe_refund_id VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_refund_status VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_refund_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS refund_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pickup_orders_refund_reconciliation
  ON pickup_orders (status, stripe_refund_status, updated_at)
  WHERE status IN ('cancellation_pending', 'completed');
