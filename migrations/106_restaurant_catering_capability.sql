ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS offers_catering boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catering_details jsonb;

CREATE INDEX IF NOT EXISTS idx_restaurants_offers_catering
  ON restaurants (offers_catering)
  WHERE offers_catering = true;

COMMENT ON COLUMN restaurants.offers_catering IS
  'True when a restaurant, food truck, bar, or caterer actively promotes catering.';

COMMENT ON COLUMN restaurants.catering_details IS
  'Structured catering profile data such as headline, description, service area, minimum guests, lead time, and contact preference.';
