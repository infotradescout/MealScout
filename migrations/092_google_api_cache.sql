-- Migration 092: Persistent Google Maps API cache
-- Stores geocoding results and address validation results so they survive
-- server restarts and are shared across all server instances.

CREATE TABLE IF NOT EXISTS google_api_cache (
  cache_key      TEXT        NOT NULL,
  cache_type     TEXT        NOT NULL,  -- 'forward_geocode' | 'reverse_geocode' | 'address_validation'
  value          JSONB       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,           -- NULL = never expires (geocoding results are permanent facts)
  CONSTRAINT google_api_cache_pkey PRIMARY KEY (cache_key, cache_type)
);

CREATE INDEX IF NOT EXISTS idx_google_api_cache_type_key
  ON google_api_cache (cache_type, cache_key);

CREATE INDEX IF NOT EXISTS idx_google_api_cache_expires
  ON google_api_cache (expires_at)
  WHERE expires_at IS NOT NULL;
