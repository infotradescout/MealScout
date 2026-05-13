-- Migration 097: county/FIPS enrichment fields for market heatmap sources

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_restaurants_county_fips
  ON restaurants(county_fips);

ALTER TABLE truck_import_listings
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_truck_import_listings_county_fips
  ON truck_import_listings(county_fips);

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_suppliers_county_fips
  ON suppliers(county_fips);

ALTER TABLE supply_store_locations
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_supply_store_locations_county_fips
  ON supply_store_locations(county_fips);

ALTER TABLE user_addresses
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_user_addresses_county_fips
  ON user_addresses(county_fips);

ALTER TABLE restaurant_submissions
  ADD COLUMN IF NOT EXISTS county_fips varchar,
  ADD COLUMN IF NOT EXISTS county_name varchar,
  ADD COLUMN IF NOT EXISTS geo_enriched_at timestamp;

CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_county_fips
  ON restaurant_submissions(county_fips);
