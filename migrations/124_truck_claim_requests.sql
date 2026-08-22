-- Durable food-truck import claim requests used by owner claim and review flows.
-- This is additive for existing databases and fills the historical clean-chain gap.

CREATE TABLE IF NOT EXISTS truck_claim_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id VARCHAR NOT NULL REFERENCES truck_import_listings(id),
  restaurant_id VARCHAR REFERENCES restaurants(id),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  status VARCHAR NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewer_id VARCHAR REFERENCES users(id),
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_truck_claim_listing
  ON truck_claim_requests(listing_id);

CREATE INDEX IF NOT EXISTS idx_truck_claim_status
  ON truck_claim_requests(status);
