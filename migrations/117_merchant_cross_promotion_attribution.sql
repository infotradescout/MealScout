ALTER TABLE "pickup_orders"
  ADD COLUMN IF NOT EXISTS "promotion_source_restaurant_id" varchar
    REFERENCES "restaurants"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "promotion_affiliate_user_id" varchar
    REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_pickup_orders_promotion_source"
  ON "pickup_orders" ("promotion_source_restaurant_id");
