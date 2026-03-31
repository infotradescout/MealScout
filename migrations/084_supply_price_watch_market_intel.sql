-- Supply market intelligence: user price watches, alert feed, and daily snapshots.
-- This file intentionally avoids DO blocks because scripts/runSqlMigration.ts splits statements on semicolons.

CREATE TABLE IF NOT EXISTS "supply_price_watches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "buyer_restaurant_id" varchar REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "item_key" varchar NOT NULL,
  "item_name" varchar NOT NULL,
  "target_price_cents" integer,
  "max_radius_miles" integer NOT NULL DEFAULT 25,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_triggered_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_supply_price_watches_user"
  ON "supply_price_watches" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_supply_price_watches_item_key"
  ON "supply_price_watches" ("item_key");

CREATE INDEX IF NOT EXISTS "idx_supply_price_watches_active"
  ON "supply_price_watches" ("is_active");

CREATE TABLE IF NOT EXISTS "supply_price_alerts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "watch_id" varchar REFERENCES "supply_price_watches"("id") ON DELETE SET NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "buyer_restaurant_id" varchar REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "item_key" varchar NOT NULL,
  "item_name" varchar NOT NULL,
  "alert_type" varchar NOT NULL DEFAULT 'price_target_hit',
  "message" text NOT NULL,
  "observed_price_cents" integer,
  "baseline_price_cents" integer,
  "observed_at" timestamp,
  "store_id" varchar REFERENCES "supply_stores"("id") ON DELETE SET NULL,
  "store_location_id" varchar REFERENCES "supply_store_locations"("id") ON DELETE SET NULL,
  "store_name" varchar,
  "store_city" varchar,
  "store_state" varchar,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_supply_price_alerts_user_created"
  ON "supply_price_alerts" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_supply_price_alerts_watch"
  ON "supply_price_alerts" ("watch_id");

CREATE INDEX IF NOT EXISTS "idx_supply_price_alerts_item_key"
  ON "supply_price_alerts" ("item_key");

CREATE TABLE IF NOT EXISTS "supply_price_daily_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_key" varchar NOT NULL,
  "item_name" varchar NOT NULL,
  "area_key" varchar NOT NULL,
  "snapshot_day" varchar NOT NULL,
  "min_price_cents" integer,
  "median_price_cents" integer,
  "max_price_cents" integer,
  "sample_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_supply_price_daily_snapshots_item_area_day"
  ON "supply_price_daily_snapshots" ("item_key", "area_key", "snapshot_day");

CREATE INDEX IF NOT EXISTS "idx_supply_price_daily_snapshots_item_day"
  ON "supply_price_daily_snapshots" ("item_key", "snapshot_day");
