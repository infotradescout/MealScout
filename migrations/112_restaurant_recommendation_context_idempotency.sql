-- Durable quick-review idempotency and database-level score integrity.
-- The recommendation row is already unique per restaurant/user, so the
-- context timestamp and payload fingerprint are the durable state used across
-- server replicas.
ALTER TABLE restaurant_user_recommendations
  ADD COLUMN IF NOT EXISTS context_review_id varchar
    REFERENCES reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context_submitted_at timestamp,
  ADD COLUMN IF NOT EXISTS context_payload_fingerprint varchar(64);

-- PR #206 could write quick-review context before durable idempotency markers
-- existed. Conservatively recognize only evidence created by that flow:
-- structured scores, a post-recommendation rating=0 text/photo review, or an
-- image-upload row attached directly to the recommendation. The sentinel
-- fingerprint intentionally blocks a new payload; an exact legacy payload
-- cannot be reconstructed safely from Cloudinary-transformed output.
WITH legacy_context AS (
  SELECT
    rur.id AS recommendation_id,
    legacy_review.id AS review_id,
    COALESCE(
      legacy_review.created_at,
      legacy_upload.uploaded_at,
      rur.recommended_at,
      rur.created_at,
      now()
    ) AS submitted_at
  FROM restaurant_user_recommendations rur
  LEFT JOIN LATERAL (
    SELECT rv.id, rv.created_at
    FROM reviews rv
    WHERE rv.restaurant_id = rur.restaurant_id
      AND rv.user_id = rur.user_id
      AND rv.rating = 0
      AND rv.comment IS NOT NULL
      AND length(trim(rv.comment)) > 0
      AND rv.created_at >= COALESCE(
        rur.recommended_at,
        rur.created_at,
        '-infinity'::timestamp
      )
    ORDER BY rv.created_at ASC, rv.id ASC
    LIMIT 1
  ) legacy_review ON true
  LEFT JOIN LATERAL (
    SELECT iu.uploaded_at
    FROM image_uploads iu
    WHERE iu.entity_type = 'restaurant_recommendation'
      AND iu.image_type = 'restaurant_recommendation_photo'
      AND iu.entity_id = rur.id
    ORDER BY iu.uploaded_at ASC, iu.id ASC
    LIMIT 1
  ) legacy_upload ON true
  WHERE rur.context_submitted_at IS NULL
    AND (
      rur.food_score IS NOT NULL
      OR rur.value_score IS NOT NULL
      OR rur.speed_score IS NOT NULL
      OR rur.vibe_score IS NOT NULL
      OR rur.context_review_id IS NOT NULL
      OR legacy_review.id IS NOT NULL
      OR legacy_upload.uploaded_at IS NOT NULL
    )
)
UPDATE restaurant_user_recommendations rur
SET
  context_review_id = COALESCE(rur.context_review_id, legacy_context.review_id),
  context_submitted_at = legacy_context.submitted_at,
  context_payload_fingerprint = COALESCE(
    rur.context_payload_fingerprint,
    'legacy'
  )
FROM legacy_context
WHERE rur.id = legacy_context.recommendation_id;

-- Fail closed for any partially rolled-out marker whose original payload was
-- not recorded. New writes always store a SHA-256 fingerprint.
UPDATE restaurant_user_recommendations
SET context_payload_fingerprint = 'legacy'
WHERE context_submitted_at IS NOT NULL
  AND context_payload_fingerprint IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_recommendations_context_review
  ON restaurant_user_recommendations (context_review_id)
  WHERE context_review_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_restaurant_recommendations_food_score'
      AND conrelid = 'restaurant_user_recommendations'::regclass
  ) THEN
    ALTER TABLE restaurant_user_recommendations
      ADD CONSTRAINT chk_restaurant_recommendations_food_score
      CHECK (food_score IS NULL OR food_score BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_restaurant_recommendations_value_score'
      AND conrelid = 'restaurant_user_recommendations'::regclass
  ) THEN
    ALTER TABLE restaurant_user_recommendations
      ADD CONSTRAINT chk_restaurant_recommendations_value_score
      CHECK (value_score IS NULL OR value_score BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_restaurant_recommendations_speed_score'
      AND conrelid = 'restaurant_user_recommendations'::regclass
  ) THEN
    ALTER TABLE restaurant_user_recommendations
      ADD CONSTRAINT chk_restaurant_recommendations_speed_score
      CHECK (speed_score IS NULL OR speed_score BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_restaurant_recommendations_vibe_score'
      AND conrelid = 'restaurant_user_recommendations'::regclass
  ) THEN
    ALTER TABLE restaurant_user_recommendations
      ADD CONSTRAINT chk_restaurant_recommendations_vibe_score
      CHECK (vibe_score IS NULL OR vibe_score BETWEEN 1 AND 100);
  END IF;
END $$;
