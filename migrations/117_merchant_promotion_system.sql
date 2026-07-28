CREATE TABLE IF NOT EXISTS merchant_promotion_policies (
  restaurant_id varchar PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  approval_mode varchar NOT NULL DEFAULT 'automatic',
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT merchant_promotion_policy_mode
    CHECK (approval_mode IN ('automatic', 'approved_only'))
);

CREATE TABLE IF NOT EXISTS merchant_promotion_partners (
  source_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  target_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  status varchar NOT NULL,
  commission_bps integer NOT NULL DEFAULT 0,
  target_approved_at timestamp,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (source_restaurant_id, target_restaurant_id),
  CONSTRAINT merchant_promotion_partner_status
    CHECK (status IN ('approved', 'excluded')),
  CONSTRAINT merchant_promotion_commission_range
    CHECK (commission_bps BETWEEN 0 AND 10000),
  CONSTRAINT merchant_promotion_distinct_businesses
    CHECK (source_restaurant_id <> target_restaurant_id)
);

CREATE TABLE IF NOT EXISTS promotion_attributions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash varchar NOT NULL UNIQUE,
  source_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  target_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  affiliate_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  session_id varchar,
  customer_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  order_id varchar UNIQUE REFERENCES pickup_orders(id) ON DELETE SET NULL,
  clicked_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL,
  converted_at timestamp,
  CONSTRAINT promotion_attribution_distinct_businesses
    CHECK (source_restaurant_id <> target_restaurant_id)
);

CREATE TABLE IF NOT EXISTS promoted_order_commissions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id varchar NOT NULL UNIQUE REFERENCES pickup_orders(id) ON DELETE CASCADE,
  attribution_id varchar NOT NULL UNIQUE REFERENCES promotion_attributions(id) ON DELETE CASCADE,
  source_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  target_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  affiliate_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commission_bps integer NOT NULL,
  eligible_order_cents integer NOT NULL,
  amount_cents integer NOT NULL,
  status varchar NOT NULL DEFAULT 'pending',
  eligible_at timestamp,
  reversed_at timestamp,
  paid_at timestamp,
  reversal_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT promoted_order_commission_status
    CHECK (status IN ('pending', 'eligible', 'reversed', 'paid')),
  CONSTRAINT promoted_order_commission_amounts
    CHECK (
      commission_bps BETWEEN 1 AND 10000
      AND eligible_order_cents >= 0
      AND amount_cents >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_promotion_partners_target
  ON merchant_promotion_partners(target_restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_promotion_attributions_source
  ON promotion_attributions(source_restaurant_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_promotion_attributions_target
  ON promotion_attributions(target_restaurant_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_promoted_commissions_affiliate
  ON promoted_order_commissions(affiliate_user_id, status);
CREATE INDEX IF NOT EXISTS idx_promoted_commissions_source
  ON promoted_order_commissions(source_restaurant_id, created_at);
