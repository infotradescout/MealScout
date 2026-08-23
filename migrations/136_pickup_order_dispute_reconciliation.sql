ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS stripe_dispute_id VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_dispute_status VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_dispute_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_dispute_reason VARCHAR,
  ADD COLUMN IF NOT EXISTS dispute_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS dispute_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pickup_orders_dispute_reconciliation
  ON pickup_orders (payout_status, dispute_updated_at)
  WHERE stripe_dispute_id IS NOT NULL
    AND payout_status IN ('dispute_reversal_pending', 'dispute_reinstatement_pending', 'failed');
