-- Seed 3D Eats public schedule from confirmed flyer.
-- Confirmed for the upcoming Wednesday relative to 2026-05-31.
-- Dates: Wednesday 2026-06-03 through Sunday 2026-06-07.
-- Addresses updated from flyer location notes provided by operations.

WITH target_truck AS (
  SELECT id
  FROM restaurants
  WHERE lower(trim(name)) IN ('3d eats', '3-d eats', '3d-eats')
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
), schedule_rows AS (
  SELECT *
  FROM (VALUES
    ('2026-06-03'::timestamp, '11:00 AM', '2:00 PM', 'Sacred Heart Children''s Hospital', '1 Bubba Watson Dr, Pensacola, FL 32504', 'Pensacola', 'FL', '3D Eats schedule stop from confirmed flyer. Main Ascension Sacred Heart campus is also associated with 5151 N 9th Ave, Pensacola, FL 32504.'),
    ('2026-06-04'::timestamp, '11:00 AM', '1:00 PM', 'Private Lunch at Building 5', '1101 Navy Federal Way, Pensacola, FL 32526', 'Pensacola', 'FL', 'Private NFCU Building 5 lunch from confirmed 3D Eats flyer. Verify exact building access before public navigation if needed.'),
    ('2026-06-04'::timestamp, '5:00 PM', '7:00 PM-ish', 'Ashley Plantation Subdivision', 'Alderbrook Blvd & Caldwell Cir, Pace, FL 32571', 'Pace', 'FL', 'Evening subdivision stop from confirmed 3D Eats flyer. Best navigation point is Alderbrook Blvd / Caldwell Cir area.'),
    ('2026-06-05'::timestamp, '11:00 AM', '1:00 PM', 'City Hall', '222 W Main St, Pensacola, FL 32502', 'Pensacola', 'FL', 'Likely Pensacola City Hall. Flyer art references Perdido, so verify with 3D Eats before posting this one publicly.'),
    ('2026-06-05'::timestamp, '5:00 PM', '9:00 PM', 'Perdido Baseball Tournament', '2020 Bauer Road, Pensacola, FL 32506', 'Pensacola', 'FL', 'Tournament stop at Perdido Bay Youth Sports Association from confirmed 3D Eats flyer.'),
    ('2026-06-06'::timestamp, '10:00 AM', 'TBD', 'Perdido Baseball Tournament', '2020 Bauer Road, Pensacola, FL 32506', 'Pensacola', 'FL', 'Saturday tournament stop at Perdido Bay Youth Sports Association. Flyer listed end time as ??; update once confirmed.'),
    ('2026-06-07'::timestamp, '10:00 AM', 'TBD', 'Perdido Baseball Tournament', '2020 Bauer Road, Pensacola, FL 32506', 'Pensacola', 'FL', 'Sunday tournament stop at Perdido Bay Youth Sports Association. Flyer listed end time as ??; update once confirmed.')
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
