ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS item_type varchar;

UPDATE menu_items
SET item_type = 'food'
WHERE item_type IS NULL OR trim(item_type) = '';

ALTER TABLE menu_items
  ALTER COLUMN item_type SET DEFAULT 'food',
  ALTER COLUMN item_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_item_type
  ON menu_items(item_type);
