-- Daily parking reports for food trucks (Parking Pass + manual stops)

CREATE TABLE IF NOT EXISTS truck_parking_reports (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date timestamp NOT NULL,
  source_type varchar NOT NULL DEFAULT 'booking',
  booking_id varchar REFERENCES event_bookings(id) ON DELETE SET NULL,
  manual_schedule_id varchar REFERENCES truck_manual_schedules(id) ON DELETE SET NULL,
  host_id varchar REFERENCES hosts(id) ON DELETE SET NULL,
  location_name varchar,
  address varchar,
  city varchar,
  state varchar,
  rating integer,
  arrival_cleanliness integer,
  customers_served integer,
  sales_cents integer,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_truck_parking_reports_truck
  ON truck_parking_reports(truck_id, date);

CREATE INDEX IF NOT EXISTS idx_truck_parking_reports_date
  ON truck_parking_reports(date);

CREATE INDEX IF NOT EXISTS idx_truck_parking_reports_booking
  ON truck_parking_reports(booking_id);

CREATE INDEX IF NOT EXISTS idx_truck_parking_reports_manual
  ON truck_parking_reports(manual_schedule_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_truck_parking_reports_booking'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'i'
      AND relname = 'uq_truck_parking_reports_booking'
  ) THEN
    ALTER TABLE truck_parking_reports
      ADD CONSTRAINT uq_truck_parking_reports_booking UNIQUE (booking_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_truck_parking_reports_manual'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'i'
      AND relname = 'uq_truck_parking_reports_manual'
  ) THEN
    ALTER TABLE truck_parking_reports
      ADD CONSTRAINT uq_truck_parking_reports_manual UNIQUE (manual_schedule_id);
  END IF;
END $$;
