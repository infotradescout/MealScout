-- Seed CreativBowls public schedule from provided June 2026 flyer.
-- Confirmed active dates from flyer: 2026-06-03, 2026-06-04, 2026-06-06, 2026-06-07.
-- Flyer also lists June 1, 2, and 5 as closed; those are intentionally not inserted because truck_manual_schedules stores active public stops.

WITH target_truck AS (
  SELECT id
  FROM restaurants
  WHERE lower(regexp_replace(trim(name), '[^a-z0-9]+', '', 'g')) IN (
    'creativbowls',
    'creativebowls',
    'creativbowl',
    'creativebowl'
  )
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
), schedule_rows AS (
  SELECT *
  FROM (VALUES
    ('2026-06-03'::timestamp, '11:00 AM', '3:00 PM', 'Home Location', '5722 Stewart St, Milton, FL 32570', 'Milton', 'FL', 'CreativBowls schedule stop from provided June 2026 flyer.'),
    ('2026-06-04'::timestamp, '5:00 PM', '8:00 PM', 'The Market of Milton', '5203 Elmira St, Milton, FL 32570', 'Milton', 'FL', 'CreativBowls schedule stop from provided June 2026 flyer.'),
    ('2026-06-06'::timestamp, '9:00 AM', '2:00 PM', 'Hometown Contractors', '4500 Bell Ln, Pace, FL 32571', 'Pace', 'FL', 'CreativBowls schedule stop from provided June 2026 flyer.'),
    ('2026-06-07'::timestamp, '12:00 PM', '3:00 PM', 'Alaqua Animal Refuge', '155 Dugas Way, Freeport, FL 32439', 'Freeport', 'FL', 'CreativBowls schedule stop from provided June 2026 flyer.')
  ) AS row_data(date, start_time, end_time, location_name, address, city, state, notes)
)
INSERT INTO truck_manual_schedules (
  truck_id,
  date,
  start_time,
  end_time,
  location_name,
  address,
  city,
  state,
  notes,
  is_public
)
SELECT
  target_truck.id,
  schedule_rows.date,
  schedule_rows.start_time,
  schedule_rows.end_time,
  schedule_rows.location_name,
  schedule_rows.address,
  schedule_rows.city,
  schedule_rows.state,
  schedule_rows.notes,
  true
FROM target_truck
CROSS JOIN schedule_rows
WHERE NOT EXISTS (
  SELECT 1
  FROM truck_manual_schedules existing
  WHERE existing.truck_id = target_truck.id
    AND existing.date = schedule_rows.date
    AND existing.start_time = schedule_rows.start_time
    AND existing.location_name = schedule_rows.location_name
);
