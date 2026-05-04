-- Caterers are modeled as a restaurant-side business subtype.
-- The column is varchar, so no enum rewrite is required.
CREATE INDEX IF NOT EXISTS idx_restaurants_business_type
  ON restaurants (business_type);

COMMENT ON COLUMN restaurants.business_type IS
  'Business subtype: restaurant, bar, food_truck, or caterer.';
