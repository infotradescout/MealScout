CREATE TABLE IF NOT EXISTS sentiment_signal_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  source varchar(24) NOT NULL,
  score_100 integer NOT NULL,
  previous_score_100 integer,
  delta_score_100 integer,
  menu_item_name varchar(140),
  cuisine_type varchar(120),
  city varchar(120),
  state varchar(80),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_created"
  ON sentiment_signal_events (created_at DESC);

CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_restaurant_created"
  ON sentiment_signal_events (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_source_created"
  ON sentiment_signal_events (source, created_at DESC);

CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_city_created"
  ON sentiment_signal_events (city, created_at DESC);

CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_cuisine_created"
  ON sentiment_signal_events (cuisine_type, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sentiment_signal_events_score_100_range'
  ) THEN
    ALTER TABLE sentiment_signal_events
      ADD CONSTRAINT sentiment_signal_events_score_100_range
      CHECK (score_100 BETWEEN 1 AND 100);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sentiment_signal_events_prev_score_100_range'
  ) THEN
    ALTER TABLE sentiment_signal_events
      ADD CONSTRAINT sentiment_signal_events_prev_score_100_range
      CHECK (
        previous_score_100 IS NULL OR
        previous_score_100 BETWEEN 1 AND 100
      );
  END IF;
END
$$;
