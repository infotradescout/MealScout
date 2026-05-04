CREATE TABLE IF NOT EXISTS recommendation_comments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id varchar NOT NULL REFERENCES restaurant_user_recommendations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id varchar REFERENCES recommendation_comments(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  is_approved boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_recommendation_comments_recommendation
  ON recommendation_comments (recommendation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_comments_user
  ON recommendation_comments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_comments_parent
  ON recommendation_comments (parent_comment_id);
