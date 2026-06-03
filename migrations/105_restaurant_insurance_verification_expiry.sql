ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS insurance_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS insurance_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS insurance_verified_by_user_id varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'restaurants_insurance_verified_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE restaurants
      ADD CONSTRAINT restaurants_insurance_verified_by_user_id_users_id_fk
      FOREIGN KEY (insurance_verified_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE restaurants
SET
  insurance_verified = true,
  insurance_verified_at = COALESCE(insurance_verified_at, updated_at, NOW()),
  insurance_expires_at = COALESCE(insurance_expires_at, NOW() + INTERVAL '365 days')
WHERE is_verified = true
  AND insurance_verified IS DISTINCT FROM true;
