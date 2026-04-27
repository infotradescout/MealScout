ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS community_builder_bonus_points integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS community_builder_bonus_reason text,
  ADD COLUMN IF NOT EXISTS community_builder_bonus_set_at timestamp,
  ADD COLUMN IF NOT EXISTS community_builder_bonus_set_by_user_id varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_restaurants_community_builder_bonus_set_by_user'
      AND table_name = 'restaurants'
  ) THEN
    ALTER TABLE restaurants
      ADD CONSTRAINT fk_restaurants_community_builder_bonus_set_by_user
      FOREIGN KEY (community_builder_bonus_set_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE restaurants
SET community_builder_bonus_points = 0
WHERE community_builder_bonus_points IS NULL;
