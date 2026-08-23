ALTER TABLE order_notifications
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_order_notifications_retryable
  ON order_notifications (status, sent_at)
  WHERE status IN ('pending', 'failed');
