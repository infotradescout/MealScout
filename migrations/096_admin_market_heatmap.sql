-- Migration 096: admin county-level market intelligence heatmap

CREATE TABLE IF NOT EXISTS market_counties (
  county_fips varchar PRIMARY KEY,
  county_name varchar NOT NULL,
  state_code varchar NOT NULL,
  state_name varchar,
  centroid_lat numeric(10, 8),
  centroid_lng numeric(11, 8),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_counties_state
  ON market_counties(state_code);

CREATE INDEX IF NOT EXISTS idx_market_counties_name_state
  ON market_counties(county_name, state_code);

CREATE TABLE IF NOT EXISTS market_metrics (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips varchar NOT NULL REFERENCES market_counties(county_fips) ON DELETE CASCADE,
  metric_key varchar NOT NULL,
  metric_value integer NOT NULL DEFAULT 0,
  timeframe varchar NOT NULL DEFAULT '30d',
  updated_at timestamp DEFAULT now(),
  CONSTRAINT uq_market_metrics_county_key_timeframe UNIQUE(county_fips, metric_key, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_market_metrics_county
  ON market_metrics(county_fips);

CREATE INDEX IF NOT EXISTS idx_market_metrics_key
  ON market_metrics(metric_key);

CREATE INDEX IF NOT EXISTS idx_market_metrics_timeframe
  ON market_metrics(timeframe);

CREATE TABLE IF NOT EXISTS market_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips varchar NOT NULL REFERENCES market_counties(county_fips) ON DELETE CASCADE,
  author_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  category varchar NOT NULL DEFAULT 'general',
  content text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_notes_county
  ON market_notes(county_fips);

CREATE INDEX IF NOT EXISTS idx_market_notes_category
  ON market_notes(category);

CREATE INDEX IF NOT EXISTS idx_market_notes_created
  ON market_notes(created_at);

CREATE TABLE IF NOT EXISTS market_entities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips varchar NOT NULL REFERENCES market_counties(county_fips) ON DELETE CASCADE,
  entity_type varchar NOT NULL,
  entity_id varchar,
  label varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_entities_county
  ON market_entities(county_fips);

CREATE INDEX IF NOT EXISTS idx_market_entities_type
  ON market_entities(entity_type);

CREATE INDEX IF NOT EXISTS idx_market_entities_status
  ON market_entities(status);
