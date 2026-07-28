-- A published menu item may be discoverable even when the business has not
-- supplied a current price. Checkout continues to require a concrete price.
ALTER TABLE menu_items
  ALTER COLUMN price_cents DROP NOT NULL;
