-- Parking Pass locations are ongoing by default.
-- Older rows were created with 30-day end dates, which caused all public
-- booking inventory to disappear after the window elapsed.

ALTER TABLE event_series
  ALTER COLUMN end_date DROP NOT NULL;

UPDATE event_series es
SET
  start_date = LEAST(COALESCE(es.start_date, CURRENT_DATE), CURRENT_DATE),
  end_date = NULL,
  default_start_time = COALESCE(NULLIF(es.default_start_time, ''), NULLIF(h.parking_pass_start_time, ''), '07:00'),
  default_end_time = COALESCE(NULLIF(es.default_end_time, ''), NULLIF(h.parking_pass_end_time, ''), '21:00'),
  default_max_trucks = GREATEST(
    COALESCE(es.default_max_trucks, 0),
    COALESCE(h.spot_count, 0),
    1
  ),
  parking_pass_days_of_week = COALESCE(es.parking_pass_days_of_week, h.parking_pass_days_of_week, '[]'::jsonb),
  default_breakfast_price_cents = COALESCE(NULLIF(es.default_breakfast_price_cents, 0), h.parking_pass_breakfast_price_cents, 0),
  default_lunch_price_cents = COALESCE(NULLIF(es.default_lunch_price_cents, 0), h.parking_pass_lunch_price_cents, 0),
  default_dinner_price_cents = COALESCE(NULLIF(es.default_dinner_price_cents, 0), h.parking_pass_dinner_price_cents, 0),
  default_daily_price_cents = COALESCE(NULLIF(es.default_daily_price_cents, 0), h.parking_pass_daily_price_cents, 0),
  default_weekly_price_cents = COALESCE(NULLIF(es.default_weekly_price_cents, 0), h.parking_pass_weekly_price_cents, 0),
  default_monthly_price_cents = COALESCE(NULLIF(es.default_monthly_price_cents, 0), h.parking_pass_monthly_price_cents, 0),
  default_host_price_cents = COALESCE(
    NULLIF(es.default_host_price_cents, 0),
    h.parking_pass_daily_price_cents,
    h.parking_pass_breakfast_price_cents + h.parking_pass_lunch_price_cents + h.parking_pass_dinner_price_cents,
    0
  ),
  status = CASE
    WHEN COALESCE(TRIM(h.address), '') <> ''
      AND GREATEST(
        h.parking_pass_breakfast_price_cents,
        h.parking_pass_lunch_price_cents,
        h.parking_pass_dinner_price_cents,
        h.parking_pass_daily_price_cents,
        h.parking_pass_weekly_price_cents,
        h.parking_pass_monthly_price_cents
      ) > 0
    THEN 'published'
    ELSE es.status
  END,
  published_at = CASE
    WHEN COALESCE(TRIM(h.address), '') <> ''
      AND GREATEST(
        h.parking_pass_breakfast_price_cents,
        h.parking_pass_lunch_price_cents,
        h.parking_pass_dinner_price_cents,
        h.parking_pass_daily_price_cents,
        h.parking_pass_weekly_price_cents,
        h.parking_pass_monthly_price_cents
      ) > 0
    THEN COALESCE(es.published_at, NOW())
    ELSE es.published_at
  END,
  updated_at = NOW()
FROM hosts h
WHERE es.host_id = h.id
  AND es.series_type = 'parking_pass';
