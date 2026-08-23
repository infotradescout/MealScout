ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS ordering_authority_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN restaurants.ordering_authority_version IS
  'Monotonic revision bumped whenever restaurant, owner, menu, inventory, options, or truck-stop evidence can change native ordering readiness.';

CREATE OR REPLACE FUNCTION mealscout_bump_restaurant_ordering_authority(
  target_restaurant_id VARCHAR
)
RETURNS VOID AS $$
BEGIN
  IF target_restaurant_id IS NOT NULL THEN
    UPDATE restaurants
       SET ordering_authority_version = ordering_authority_version + 1
     WHERE id = target_restaurant_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mealscout_restaurant_ordering_authority_before_update()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW.owner_id,
    NEW.name,
    NEW.address,
    NEW.city,
    NEW.state,
    NEW.raw_data,
    NEW.is_food_truck,
    NEW.operating_hours,
    NEW.is_active,
    NEW.is_verified,
    NEW.stripe_connect_account_id,
    NEW.stripe_connect_status,
    NEW.stripe_onboarding_completed,
    NEW.stripe_charges_enabled,
    NEW.stripe_payouts_enabled,
    NEW.ordering_approved_at,
    NEW.ordering_approved_by_user_id,
    NEW.pickup_acknowledgement_minutes
  ) IS DISTINCT FROM ROW(
    OLD.owner_id,
    OLD.name,
    OLD.address,
    OLD.city,
    OLD.state,
    OLD.raw_data,
    OLD.is_food_truck,
    OLD.operating_hours,
    OLD.is_active,
    OLD.is_verified,
    OLD.stripe_connect_account_id,
    OLD.stripe_connect_status,
    OLD.stripe_onboarding_completed,
    OLD.stripe_charges_enabled,
    OLD.stripe_payouts_enabled,
    OLD.ordering_approved_at,
    OLD.ordering_approved_by_user_id,
    OLD.pickup_acknowledgement_minutes
  ) THEN
    NEW.ordering_authority_version := OLD.ordering_authority_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_restaurant_ordering_authority_before_update ON restaurants;
CREATE TRIGGER trigger_restaurant_ordering_authority_before_update
BEFORE UPDATE ON restaurants
FOR EACH ROW EXECUTE FUNCTION mealscout_restaurant_ordering_authority_before_update();

CREATE OR REPLACE FUNCTION mealscout_owner_ordering_authority_after_update()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.email, NEW.email_verified, NEW.is_disabled, NEW.public_profile_settings)
     IS DISTINCT FROM
     ROW(OLD.email, OLD.email_verified, OLD.is_disabled, OLD.public_profile_settings) THEN
    UPDATE restaurants
       SET ordering_authority_version = ordering_authority_version + 1
     WHERE owner_id = NEW.id;

    UPDATE restaurants AS restaurant
       SET ordering_authority_version = restaurant.ordering_authority_version + 1
      FROM hosts AS host
      JOIN events AS event ON event.host_id = host.id
      JOIN event_bookings AS booking ON booking.event_id = event.id
     WHERE host.user_id = NEW.id
       AND restaurant.id = booking.truck_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_owner_ordering_authority_after_update ON users;
CREATE TRIGGER trigger_owner_ordering_authority_after_update
AFTER UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION mealscout_owner_ordering_authority_after_update();

CREATE OR REPLACE FUNCTION mealscout_direct_restaurant_dependency_authority()
RETURNS TRIGGER AS $$
DECLARE
  old_restaurant_id VARCHAR;
  new_restaurant_id VARCHAR;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_restaurant_id := OLD.restaurant_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_restaurant_id := NEW.restaurant_id;
  END IF;

  PERFORM mealscout_bump_restaurant_ordering_authority(old_restaurant_id);
  IF new_restaurant_id IS DISTINCT FROM old_restaurant_id THEN
    PERFORM mealscout_bump_restaurant_ordering_authority(new_restaurant_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_menu_ordering_authority ON menus;
CREATE TRIGGER trigger_menu_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON menus
FOR EACH ROW EXECUTE FUNCTION mealscout_direct_restaurant_dependency_authority();

DROP TRIGGER IF EXISTS trigger_menu_category_ordering_authority ON menu_categories;
CREATE TRIGGER trigger_menu_category_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON menu_categories
FOR EACH ROW EXECUTE FUNCTION mealscout_direct_restaurant_dependency_authority();

DROP TRIGGER IF EXISTS trigger_menu_item_ordering_authority ON menu_items;
CREATE TRIGGER trigger_menu_item_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON menu_items
FOR EACH ROW EXECUTE FUNCTION mealscout_direct_restaurant_dependency_authority();

CREATE OR REPLACE FUNCTION mealscout_menu_option_ordering_authority()
RETURNS TRIGGER AS $$
DECLARE
  old_item_id VARCHAR;
  new_item_id VARCHAR;
  target_restaurant_id VARCHAR;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_item_id := OLD.menu_item_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_item_id := NEW.menu_item_id; END IF;

  SELECT restaurant_id INTO target_restaurant_id
    FROM menu_items WHERE id = old_item_id;
  PERFORM mealscout_bump_restaurant_ordering_authority(target_restaurant_id);

  IF new_item_id IS DISTINCT FROM old_item_id THEN
    SELECT restaurant_id INTO target_restaurant_id
      FROM menu_items WHERE id = new_item_id;
    PERFORM mealscout_bump_restaurant_ordering_authority(target_restaurant_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_menu_item_variant_ordering_authority ON menu_item_variants;
CREATE TRIGGER trigger_menu_item_variant_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON menu_item_variants
FOR EACH ROW EXECUTE FUNCTION mealscout_menu_option_ordering_authority();

DROP TRIGGER IF EXISTS trigger_menu_item_modifier_ordering_authority ON menu_item_modifiers;
CREATE TRIGGER trigger_menu_item_modifier_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON menu_item_modifiers
FOR EACH ROW EXECUTE FUNCTION mealscout_menu_option_ordering_authority();

CREATE OR REPLACE FUNCTION mealscout_truck_schedule_ordering_authority()
RETURNS TRIGGER AS $$
DECLARE
  old_truck_id VARCHAR;
  new_truck_id VARCHAR;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_truck_id := OLD.truck_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_truck_id := NEW.truck_id; END IF;
  PERFORM mealscout_bump_restaurant_ordering_authority(old_truck_id);
  IF new_truck_id IS DISTINCT FROM old_truck_id THEN
    PERFORM mealscout_bump_restaurant_ordering_authority(new_truck_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_truck_manual_schedule_ordering_authority ON truck_manual_schedules;
CREATE TRIGGER trigger_truck_manual_schedule_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON truck_manual_schedules
FOR EACH ROW EXECUTE FUNCTION mealscout_truck_schedule_ordering_authority();

DROP TRIGGER IF EXISTS trigger_event_booking_ordering_authority ON event_bookings;
CREATE TRIGGER trigger_event_booking_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON event_bookings
FOR EACH ROW EXECUTE FUNCTION mealscout_truck_schedule_ordering_authority();

CREATE OR REPLACE FUNCTION mealscout_event_ordering_authority()
RETURNS TRIGGER AS $$
DECLARE
  event_id_value VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    event_id_value := OLD.id;
  ELSE
    event_id_value := NEW.id;
  END IF;
  UPDATE restaurants AS restaurant
     SET ordering_authority_version = restaurant.ordering_authority_version + 1
    FROM event_bookings AS booking
   WHERE booking.event_id = event_id_value
     AND restaurant.id = booking.truck_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_event_ordering_authority ON events;
CREATE TRIGGER trigger_event_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION mealscout_event_ordering_authority();

CREATE OR REPLACE FUNCTION mealscout_event_series_ordering_authority()
RETURNS TRIGGER AS $$
DECLARE
  series_id_value VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    series_id_value := OLD.id;
  ELSE
    series_id_value := NEW.id;
  END IF;
  UPDATE restaurants AS restaurant
     SET ordering_authority_version = restaurant.ordering_authority_version + 1
    FROM events AS event
    JOIN event_bookings AS booking ON booking.event_id = event.id
   WHERE event.series_id = series_id_value
     AND restaurant.id = booking.truck_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_event_series_ordering_authority ON event_series;
CREATE TRIGGER trigger_event_series_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON event_series
FOR EACH ROW EXECUTE FUNCTION mealscout_event_series_ordering_authority();

CREATE OR REPLACE FUNCTION mealscout_host_ordering_authority()
RETURNS TRIGGER AS $$
DECLARE
  host_id_value VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    host_id_value := OLD.id;
  ELSE
    host_id_value := NEW.id;
  END IF;
  UPDATE restaurants AS restaurant
     SET ordering_authority_version = restaurant.ordering_authority_version + 1
    FROM events AS event
    JOIN event_bookings AS booking ON booking.event_id = event.id
   WHERE event.host_id = host_id_value
     AND restaurant.id = booking.truck_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_host_ordering_authority ON hosts;
CREATE TRIGGER trigger_host_ordering_authority
AFTER INSERT OR UPDATE OR DELETE ON hosts
FOR EACH ROW EXECUTE FUNCTION mealscout_host_ordering_authority();
