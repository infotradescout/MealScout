ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS payout_reversal_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_reversal_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS payout_reversal_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pickup_orders_payout_reversal_recovery
  ON pickup_orders (status, payout_status, payout_reversal_updated_at)
  WHERE status = 'cancelled'
    AND payment_method = 'card'
    AND (
      (stripe_refund_status = 'succeeded' AND stripe_refund_amount_cents = total_cents)
      OR (
        stripe_dispute_status = 'lost'
        AND COALESCE(stripe_refund_amount_cents, 0)
          + COALESCE(stripe_dispute_amount_cents, 0) >= total_cents
      )
    )
    AND (payout_status <> 'reversed' OR payout_reversal_updated_at IS NULL);

COMMENT ON COLUMN pickup_orders.payout_reversal_attempt_count IS
  'Idempotent merchant-transfer reversal attempts, tracked independently from customer refunds.';

COMMENT ON COLUMN pickup_orders.payout_reversal_failure_reason IS
  'Sanitized merchant-transfer recovery failure; never used as customer refund status.';

COMMENT ON COLUMN pickup_orders.payout_reversal_updated_at IS
  'Last merchant-transfer reversal reconciliation attempt.';
