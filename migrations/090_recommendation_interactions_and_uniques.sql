-- 1) Normalize existing engagement rows so strict uniqueness can be enforced safely.
WITH dedupe AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY restaurant_id, user_id
      ORDER BY favorited_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM restaurant_favorites
)
DELETE FROM restaurant_favorites t
USING dedupe d
WHERE t.ctid = d.ctid
  AND d.rn > 1;

WITH dedupe AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY restaurant_id, user_id
      ORDER BY followed_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM restaurant_follows
)
DELETE FROM restaurant_follows t
USING dedupe d
WHERE t.ctid = d.ctid
  AND d.rn > 1;

WITH dedupe AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY restaurant_id, user_id
      ORDER BY recommended_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM restaurant_user_recommendations
)
DELETE FROM restaurant_user_recommendations t
USING dedupe d
WHERE t.ctid = d.ctid
  AND d.rn > 1;

WITH dedupe AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY story_id, user_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM story_likes
)
DELETE FROM story_likes t
USING dedupe d
WHERE t.ctid = d.ctid
  AND d.rn > 1;

-- 2) Replace legacy non-unique "unique" indexes with actual unique indexes.
DROP INDEX IF EXISTS "IDX_restaurant_favorites_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_restaurant_favorites_unique"
  ON restaurant_favorites (restaurant_id, user_id);

DROP INDEX IF EXISTS "IDX_restaurant_follows_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_restaurant_follows_unique"
  ON restaurant_follows (restaurant_id, user_id);

DROP INDEX IF EXISTS "IDX_restaurant_user_recommendations_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_restaurant_user_recommendations_unique"
  ON restaurant_user_recommendations (restaurant_id, user_id);

DROP INDEX IF EXISTS "IDX_story_likes_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_story_likes_unique"
  ON story_likes (story_id, user_id);

-- 3) Recommendation-level interactions: likes/dislikes/shares.
CREATE TABLE IF NOT EXISTS recommendation_reactions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id varchar NOT NULL REFERENCES restaurant_user_recommendations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type varchar NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_reactions_rec_user
  ON recommendation_reactions (recommendation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_reactions_recommendation
  ON recommendation_reactions (recommendation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_reactions_user
  ON recommendation_reactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_shares (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id varchar NOT NULL REFERENCES restaurant_user_recommendations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_shares_recommendation
  ON recommendation_shares (recommendation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_shares_user
  ON recommendation_shares (user_id, created_at DESC);
