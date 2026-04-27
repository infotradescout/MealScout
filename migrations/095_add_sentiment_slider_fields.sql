ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS rating_score_100 integer,
  ADD COLUMN IF NOT EXISTS menu_item_name varchar(140),
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

UPDATE reviews
SET rating_score_100 = LEAST(100, GREATEST(1, COALESCE(rating, 3) * 20))
WHERE rating_score_100 IS NULL;

ALTER TABLE reviews
  ALTER COLUMN rating_score_100 SET NOT NULL,
  ALTER COLUMN rating_score_100 SET DEFAULT 50;

UPDATE reviews
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE restaurant_user_recommendations
  ADD COLUMN IF NOT EXISTS sentiment_score_100 integer,
  ADD COLUMN IF NOT EXISTS menu_item_name varchar(140),
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

UPDATE restaurant_user_recommendations
SET sentiment_score_100 = 70
WHERE sentiment_score_100 IS NULL;

ALTER TABLE restaurant_user_recommendations
  ALTER COLUMN sentiment_score_100 SET NOT NULL,
  ALTER COLUMN sentiment_score_100 SET DEFAULT 70;

UPDATE restaurant_user_recommendations
SET updated_at = COALESCE(recommended_at, created_at, now())
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_rating_score_100_range'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_rating_score_100_range
      CHECK (rating_score_100 BETWEEN 1 AND 100);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'restaurant_user_recommendations_sentiment_score_100_range'
  ) THEN
    ALTER TABLE restaurant_user_recommendations
      ADD CONSTRAINT restaurant_user_recommendations_sentiment_score_100_range
      CHECK (sentiment_score_100 BETWEEN 1 AND 100);
  END IF;
END
$$;
