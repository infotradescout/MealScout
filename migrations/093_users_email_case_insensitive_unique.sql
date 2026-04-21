-- Migration 093: Enforce case-insensitive uniqueness for users.email
-- This protects against duplicates like User@x.com vs user@x.com.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create case-insensitive unique index on users.email: duplicate normalized emails exist. Clean duplicates first.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
  ON users (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

