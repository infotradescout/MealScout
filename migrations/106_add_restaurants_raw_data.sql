ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS raw_data jsonb;
