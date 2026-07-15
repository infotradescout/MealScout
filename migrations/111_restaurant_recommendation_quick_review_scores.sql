-- Structured quick-review signals on a recommend: food/value/speed/vibe
-- (1-100 each). Not a public star rating - kept as separate honest signal
-- captured via sliders instead of requiring written text.
ALTER TABLE restaurant_user_recommendations
  ADD COLUMN IF NOT EXISTS food_score integer,
  ADD COLUMN IF NOT EXISTS value_score integer,
  ADD COLUMN IF NOT EXISTS speed_score integer,
  ADD COLUMN IF NOT EXISTS vibe_score integer;
