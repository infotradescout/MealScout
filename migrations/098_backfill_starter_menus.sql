-- Backfill starter menus for already-owned businesses created before
-- the online menu tables were present in production.

WITH inserted_menus AS (
  INSERT INTO menus (
    restaurant_id,
    name,
    service_type,
    is_active,
    accepts_cash,
    hide_platform_fee,
    import_source
  )
  SELECT
    r.id,
    'All Day Menu',
    'all',
    TRUE,
    TRUE,
    FALSE,
    'system_backfill'
  FROM restaurants r
  WHERE r.owner_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM menus m
      WHERE m.restaurant_id = r.id
    )
  RETURNING id, restaurant_id
),
menus_without_categories AS (
  SELECT m.id, m.restaurant_id
  FROM menus m
  WHERE NOT EXISTS (
    SELECT 1
    FROM menu_categories c
    WHERE c.menu_id = m.id
  )
)
INSERT INTO menu_categories (
  menu_id,
  restaurant_id,
  name,
  sort_order,
  is_active
)
SELECT id, restaurant_id, 'Menu Items', 0, TRUE
FROM (
  SELECT id, restaurant_id FROM inserted_menus
  UNION
  SELECT id, restaurant_id FROM menus_without_categories
) starter_menus;
