-- Repair Parking Pass as persistent, priced parking inventory.
--
-- This migration is intentionally non-destructive:
-- 1. Recover host defaults and capacity only when positive historical Parking Pass data exists.
-- 2. Keep unfinished zero-price locations as drafts instead of advertising them.
-- 3. Enforce the configured truck-spot capacity for paid reservations.

BEGIN;

WITH latest_priced_parking_row AS (
  SELECT DISTINCT ON (e.host_id)
    e.host_id,
    e.start_time,
    e.end_time,
    GREATEST(COALESCE(e.max_trucks, 1), 1) AS max_trucks,
    COALESCE(e.breakfast_price_cents, 0) AS breakfast_price_cents,
    COALESCE(e.lunch_price_cents, 0) AS lunch_price_cents,
    COALESCE(e.dinner_price_cents, 0) AS dinner_price_cents,
    COALESCE(e.daily_price_cents, 0) AS daily_price_cents,
    COALESCE(e.weekly_price_cents, 0) AS weekly_price_cents,
    COALESCE(e.monthly_price_cents, 0) AS monthly_price_cents
  FROM events e
  LEFT JOIN event_series source_series ON source_series.id = e.series_id
  -- Early Parking Pass rows were stored as event_type='event'; payment was
  -- combined with the Parking Pass name before the dedicated type was added.
  WHERE e.requires_payment IS TRUE
    AND (
      e.event_type = 'parking_pass'
      OR source_series.series_type = 'parking_pass'
      OR e.name ILIKE 'Parking Pass - %'
    )
    AND GREATEST(
      COALESCE(e.breakfast_price_cents, 0),
      COALESCE(e.lunch_price_cents, 0),
      COALESCE(e.dinner_price_cents, 0),
      COALESCE(e.daily_price_cents, 0),
      COALESCE(e.weekly_price_cents, 0),
      COALESCE(e.monthly_price_cents, 0)
    ) > 0
  ORDER BY e.host_id, COALESCE(e.updated_at, e.created_at) DESC, e.date DESC
)
UPDATE hosts h
SET
  spot_count = GREATEST(COALESCE(h.spot_count, 1), source.max_trucks),
  parking_pass_start_time = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0
      THEN COALESCE(NULLIF(source.start_time, ''), NULLIF(h.parking_pass_start_time, ''))
    ELSE h.parking_pass_start_time
  END,
  parking_pass_end_time = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0
      THEN COALESCE(NULLIF(source.end_time, ''), NULLIF(h.parking_pass_end_time, ''))
    ELSE h.parking_pass_end_time
  END,
  parking_pass_breakfast_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.breakfast_price_cents
    ELSE h.parking_pass_breakfast_price_cents
  END,
  parking_pass_lunch_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.lunch_price_cents
    ELSE h.parking_pass_lunch_price_cents
  END,
  parking_pass_dinner_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.dinner_price_cents
    ELSE h.parking_pass_dinner_price_cents
  END,
  parking_pass_daily_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.daily_price_cents
    ELSE h.parking_pass_daily_price_cents
  END,
  parking_pass_weekly_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.weekly_price_cents
    ELSE h.parking_pass_weekly_price_cents
  END,
  parking_pass_monthly_price_cents = CASE
    WHEN GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0 THEN source.monthly_price_cents
    ELSE h.parking_pass_monthly_price_cents
  END,
  updated_at = NOW()
FROM latest_priced_parking_row source
WHERE h.id = source.host_id
  AND (
    source.max_trucks > COALESCE(h.spot_count, 0)
    OR GREATEST(
      COALESCE(h.parking_pass_breakfast_price_cents, 0),
      COALESCE(h.parking_pass_lunch_price_cents, 0),
      COALESCE(h.parking_pass_dinner_price_cents, 0),
      COALESCE(h.parking_pass_daily_price_cents, 0),
      COALESCE(h.parking_pass_weekly_price_cents, 0),
      COALESCE(h.parking_pass_monthly_price_cents, 0)
    ) = 0
  );

UPDATE event_series es
SET
  default_start_time = COALESCE(NULLIF(h.parking_pass_start_time, ''), es.default_start_time, '07:00'),
  default_end_time = COALESCE(NULLIF(h.parking_pass_end_time, ''), es.default_end_time, '21:00'),
  default_max_trucks = GREATEST(
    COALESCE(h.spot_count, 0),
    COALESCE(es.default_max_trucks, 0),
    1
  ),
  default_hard_cap_enabled = TRUE,
  parking_pass_days_of_week = CASE
    WHEN jsonb_array_length(COALESCE(h.parking_pass_days_of_week, '[]'::jsonb)) > 0
      THEN h.parking_pass_days_of_week
    ELSE COALESCE(es.parking_pass_days_of_week, '[]'::jsonb)
  END,
  default_breakfast_price_cents = h.parking_pass_breakfast_price_cents,
  default_lunch_price_cents = h.parking_pass_lunch_price_cents,
  default_dinner_price_cents = h.parking_pass_dinner_price_cents,
  default_daily_price_cents = h.parking_pass_daily_price_cents,
  default_weekly_price_cents = h.parking_pass_weekly_price_cents,
  default_monthly_price_cents = h.parking_pass_monthly_price_cents,
  default_host_price_cents = GREATEST(
    h.parking_pass_daily_price_cents,
    h.parking_pass_breakfast_price_cents
      + h.parking_pass_lunch_price_cents
      + h.parking_pass_dinner_price_cents
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
    ELSE 'draft'
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
    ELSE NULL
  END,
  updated_at = NOW()
FROM hosts h
WHERE es.host_id = h.id
  AND es.series_type = 'parking_pass';

COMMIT;
