CREATE TABLE IF NOT EXISTS menu_draft_reviews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  profile_id varchar,
  business_name varchar NOT NULL,
  public_profile_path varchar,
  source_type varchar NOT NULL,
  source_url text NOT NULL,
  source_urls jsonb DEFAULT '[]'::jsonb,
  source_artifact_paths jsonb DEFAULT '[]'::jsonb,
  captured_at timestamp,
  artifact_path varchar,
  artifact_generated_at timestamp,
  import_status varchar NOT NULL DEFAULT 'pending_review',
  review_status varchar NOT NULL DEFAULT 'pending_review',
  confidence varchar NOT NULL DEFAULT 'low',
  currentness varchar NOT NULL DEFAULT 'unknown',
  owner_approval_needed boolean NOT NULL DEFAULT true,
  owner_approved boolean NOT NULL DEFAULT false,
  owner_approval_evidence_url text,
  reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  production_applied boolean NOT NULL DEFAULT false,
  applied_menu_id varchar REFERENCES menus(id) ON DELETE SET NULL,
  notes jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_draft_reviews_restaurant
  ON menu_draft_reviews (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_menu_draft_reviews_status
  ON menu_draft_reviews (review_status);

CREATE INDEX IF NOT EXISTS idx_menu_draft_reviews_owner_approved
  ON menu_draft_reviews (owner_approved);

CREATE INDEX IF NOT EXISTS idx_menu_draft_reviews_production_applied
  ON menu_draft_reviews (production_applied);

CREATE TABLE IF NOT EXISTS menu_draft_review_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_review_id varchar NOT NULL REFERENCES menu_draft_reviews(id) ON DELETE CASCADE,
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section_name varchar,
  section_order integer NOT NULL DEFAULT 0,
  item_name varchar NOT NULL,
  base_item_name varchar,
  variant_label varchar,
  description text,
  price_cents integer,
  price_label varchar,
  category varchar,
  options jsonb DEFAULT '[]'::jsonb,
  source_confidence varchar NOT NULL DEFAULT 'low',
  source_ref text,
  owner_approval_needed boolean NOT NULL DEFAULT true,
  owner_approved boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_draft_review_items_review
  ON menu_draft_review_items (draft_review_id);

CREATE INDEX IF NOT EXISTS idx_menu_draft_review_items_restaurant
  ON menu_draft_review_items (restaurant_id);
