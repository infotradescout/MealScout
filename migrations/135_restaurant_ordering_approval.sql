ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS ordering_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS ordering_approved_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ordering_approval_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS ordering_approval_review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_restaurants_ordering_approved
  ON restaurants (ordering_approved_at)
  WHERE ordering_approved_at IS NOT NULL;
