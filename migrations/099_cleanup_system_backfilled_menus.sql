-- Remove starter menus that were backfilled onto imported/system/test owners.
-- These rows are supply inventory, deleted placeholder accounts, or admin-owned
-- test records, not real owner businesses.

DELETE FROM menus m
USING restaurants r
LEFT JOIN users u ON u.id = r.owner_id
WHERE m.restaurant_id = r.id
  AND m.import_source = 'system_backfill'
  AND (
    u.id IS NULL
    OR coalesce(u.user_type, '') NOT IN ('restaurant_owner', 'food_truck')
    OR lower(coalesce(u.email, '')) = 'system-import@mealscout.us'
    OR lower(coalesce(u.email, '')) LIKE 'deleted+%@mealscout.invalid'
  );
