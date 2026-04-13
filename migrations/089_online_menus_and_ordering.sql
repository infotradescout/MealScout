-- Migration 089: Online Menus, Pickup Ordering & Delivery Infrastructure
-- Phase 1: menus, categories, items, variants, modifiers, import logs
-- Phase 1: pickup orders, order items, order notifications
-- Phase 2 (schema-ready, dormant): driver profiles, delivery jobs, applications

-- ── MENUS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menus (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            VARCHAR NOT NULL DEFAULT 'Menu',
  service_type    VARCHAR NOT NULL DEFAULT 'all',
  -- 'all' | 'breakfast' | 'lunch' | 'dinner' | 'late_night' | 'weekend_brunch'
  available_from  VARCHAR,   -- "06:00" 24-h HH:MM
  available_to    VARCHAR,   -- "11:00"
  available_days  JSONB NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_cash    BOOLEAN NOT NULL DEFAULT FALSE,
  hide_platform_fee BOOLEAN NOT NULL DEFAULT FALSE,
  import_source   VARCHAR,
  -- 'manual' | 'csv' | 'ubereats' | 'doordash' | 'clover' | 'toast' | 'square' | 'gmb' | 'pdf'
  imported_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menus_restaurant    ON menus(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menus_service_type  ON menus(service_type);
CREATE INDEX IF NOT EXISTS idx_menus_is_active     ON menus(is_active);

-- ── MENU CATEGORIES ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_categories (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id       VARCHAR NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  restaurant_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          VARCHAR NOT NULL,
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_categories_menu       ON menu_categories(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_sort       ON menu_categories(menu_id, sort_order);

-- ── MENU ITEMS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_items (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id         VARCHAR NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  category_id     VARCHAR REFERENCES menu_categories(id) ON DELETE SET NULL,
  restaurant_id   VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            VARCHAR NOT NULL,
  description     TEXT,
  price_cents     INTEGER NOT NULL,
  image_url       VARCHAR,
  sku             VARCHAR,
  -- Nutrition (optional)
  calories        INTEGER,
  protein_g       DECIMAL(6,2),
  carbs_g         DECIMAL(6,2),
  fat_g           DECIMAL(6,2),
  allergens       JSONB NOT NULL DEFAULT '[]'::jsonb,
  dietary_tags    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Inventory
  track_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_qty   INTEGER,
  -- Availability
  is_available    BOOLEAN NOT NULL DEFAULT TRUE,
  available_from  VARCHAR,
  available_to    VARCHAR,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_menu        ON menu_items(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category    ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant  ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available   ON menu_items(is_available);

-- ── MENU ITEM VARIANTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id        VARCHAR NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label               VARCHAR NOT NULL,
  additional_cents    INTEGER NOT NULL DEFAULT 0,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item ON menu_item_variants(menu_item_id);

-- ── MENU ITEM MODIFIERS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_item_modifiers (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id        VARCHAR NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_name          VARCHAR NOT NULL,
  label               VARCHAR NOT NULL,
  additional_cents    INTEGER NOT NULL DEFAULT 0,
  is_required         BOOLEAN NOT NULL DEFAULT FALSE,
  max_selections      INTEGER DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_item  ON menu_item_modifiers(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_group ON menu_item_modifiers(menu_item_id, group_name);

-- ── MENU IMPORT LOG ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_import_logs (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  imported_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source              VARCHAR NOT NULL,
  file_name           VARCHAR,
  items_imported      INTEGER DEFAULT 0,
  items_skipped       INTEGER DEFAULT 0,
  errors              JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              VARCHAR NOT NULL DEFAULT 'complete',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_import_logs_restaurant ON menu_import_logs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_import_logs_created    ON menu_import_logs(created_at);

-- ── PICKUP ORDERS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pickup_orders (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id             VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  customer_id               VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  customer_name             VARCHAR NOT NULL,
  customer_email            VARCHAR,
  customer_phone            VARCHAR,
  order_type                VARCHAR NOT NULL DEFAULT 'pickup',
  -- 'pickup' | 'dine_in'
  status                    VARCHAR NOT NULL DEFAULT 'pending',
  -- 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled'
  subtotal_cents            INTEGER NOT NULL,
  platform_fee_cents        INTEGER NOT NULL DEFAULT 100,
  fee_paid_by_business      BOOLEAN NOT NULL DEFAULT FALSE,
  total_cents               INTEGER NOT NULL,
  payment_method            VARCHAR NOT NULL DEFAULT 'card',
  -- 'card' | 'cash'
  stripe_payment_intent_id  VARCHAR,
  stripe_transfer_group_id  VARCHAR,
  payout_status             VARCHAR NOT NULL DEFAULT 'pending',
  -- 'pending' | 'transferred' | 'failed'
  special_instructions      TEXT,
  prep_time_minutes         INTEGER DEFAULT 20,
  scheduled_for             TIMESTAMPTZ,
  confirmed_at              TIMESTAMPTZ,
  ready_at                  TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  cancellation_reason       TEXT,
  ready_notification_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_orders_restaurant    ON pickup_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_pickup_orders_customer      ON pickup_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_pickup_orders_status        ON pickup_orders(status);
CREATE INDEX IF NOT EXISTS idx_pickup_orders_created       ON pickup_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_pickup_orders_scheduled     ON pickup_orders(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_pickup_orders_payout_status ON pickup_orders(payout_status);

-- ── PICKUP ORDER ITEMS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pickup_order_items (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             VARCHAR NOT NULL REFERENCES pickup_orders(id) ON DELETE CASCADE,
  menu_item_id         VARCHAR REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name            VARCHAR NOT NULL,
  item_description     TEXT,
  base_price_cents     INTEGER NOT NULL,
  selected_variant     JSONB,
  selected_modifiers   JSONB NOT NULL DEFAULT '[]'::jsonb,
  quantity             INTEGER NOT NULL DEFAULT 1,
  line_total_cents     INTEGER NOT NULL,
  special_instructions TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_order_items_order     ON pickup_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pickup_order_items_menu_item ON pickup_order_items(menu_item_id);

-- ── ORDER NOTIFICATIONS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_notifications (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       VARCHAR NOT NULL REFERENCES pickup_orders(id) ON DELETE CASCADE,
  channel        VARCHAR NOT NULL,
  type           VARCHAR NOT NULL,
  recipient      VARCHAR,
  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  status         VARCHAR NOT NULL DEFAULT 'sent',
  error_message  TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_notifications_order ON order_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_order_notifications_sent  ON order_notifications(sent_at);

-- ── DELIVERY INFRASTRUCTURE (Phase 2 – dormant) ──────────────────────────────

CREATE TABLE IF NOT EXISTS driver_profiles (
  id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 VARCHAR NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio                     TEXT,
  vehicle_type            VARCHAR,
  service_cities          JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_per_delivery_cents INTEGER,
  total_deliveries        INTEGER NOT NULL DEFAULT 0,
  average_rating          DECIMAL(3,2),
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  background_check_status VARCHAR DEFAULT 'none',
  resume_url              VARCHAR,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_user   ON driver_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_active ON driver_profiles(is_active);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title                 VARCHAR NOT NULL,
  description           TEXT,
  job_type              VARCHAR NOT NULL DEFAULT 'recurring',
  schedule_description  TEXT,
  rate_offered_cents    INTEGER,
  delivery_zone_radius  DECIMAL(6,2),
  status                VARCHAR NOT NULL DEFAULT 'open',
  positions_available   INTEGER DEFAULT 1,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_restaurant ON delivery_jobs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status     ON delivery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_created    ON delivery_jobs(created_at);

CREATE TABLE IF NOT EXISTS delivery_job_applications (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               VARCHAR NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_profile_id    VARCHAR NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  cover_note           TEXT,
  proposed_rate_cents  INTEGER,
  status               VARCHAR NOT NULL DEFAULT 'pending',
  responded_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_delivery_job_apps_job_driver UNIQUE (job_id, driver_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_job_apps_job    ON delivery_job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_delivery_job_apps_driver ON delivery_job_applications(driver_profile_id);
CREATE INDEX IF NOT EXISTS idx_delivery_job_apps_status ON delivery_job_applications(status);
