ALTER TABLE users
  ALTER COLUMN affiliate_percent SET DEFAULT 20;

UPDATE users
SET affiliate_percent = CASE
  WHEN user_type = 'staff' THEN 25
  WHEN user_type IN ('admin', 'super_admin') THEN 0
  ELSE 20
END;

UPDATE users target
SET affiliate_closer_percent = CASE
  WHEN referrer.user_type = 'staff' THEN 25
  WHEN referrer.user_type IN ('admin', 'super_admin') THEN 0
  ELSE 20
END
FROM users referrer
WHERE target.affiliate_closer_user_id = referrer.id;

UPDATE users target
SET affiliate_booker_percent = CASE
  WHEN referrer.user_type = 'staff' THEN 25
  WHEN referrer.user_type IN ('admin', 'super_admin') THEN 0
  ELSE 20
END
FROM users referrer
WHERE target.affiliate_booker_user_id = referrer.id;
