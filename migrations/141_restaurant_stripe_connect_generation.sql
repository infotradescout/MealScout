ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_connect_generation INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN restaurants.stripe_connect_generation IS
  'Monotonic Stripe Connect lifecycle generation advanced on owner transfer or Connect deauthorization.';

CREATE OR REPLACE FUNCTION mealscout_restaurant_connect_generation_before_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR (
       NEW.stripe_connect_status = 'revoked'
       AND OLD.stripe_connect_status IS DISTINCT FROM 'revoked'
     ) THEN
    NEW.stripe_connect_generation := OLD.stripe_connect_generation + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_restaurant_connect_generation_before_update ON restaurants;
CREATE TRIGGER trigger_restaurant_connect_generation_before_update
BEFORE UPDATE ON restaurants
FOR EACH ROW EXECUTE FUNCTION mealscout_restaurant_connect_generation_before_update();
