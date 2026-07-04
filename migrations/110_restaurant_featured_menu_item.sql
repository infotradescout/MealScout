-- Owner's manual pick for the one dish spotlighted on discovery cards.
-- No FK constraint: if the referenced item is ever deleted, resolution
-- logic falls through to the automatic ranking rather than erroring.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS featured_menu_item_id varchar;
