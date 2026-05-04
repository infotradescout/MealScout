ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS host_id varchar REFERENCES hosts(id) ON DELETE CASCADE;

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS host_id varchar REFERENCES hosts(id) ON DELETE CASCADE;

ALTER TABLE job_postings
  ALTER COLUMN restaurant_id DROP NOT NULL;

ALTER TABLE job_applications
  ALTER COLUMN restaurant_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE job_postings
    ADD CONSTRAINT chk_job_postings_single_business
    CHECK (
      ((restaurant_id IS NOT NULL)::int + (host_id IS NOT NULL)::int) = 1
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE job_applications
    ADD CONSTRAINT chk_job_applications_single_business
    CHECK (
      ((restaurant_id IS NOT NULL)::int + (host_id IS NOT NULL)::int) = 1
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_postings_host
  ON job_postings(host_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_host
  ON job_applications(host_id);

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS show_fuel_prices boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gas_price_regular_cents integer,
  ADD COLUMN IF NOT EXISTS gas_price_midgrade_cents integer,
  ADD COLUMN IF NOT EXISTS gas_price_premium_cents integer,
  ADD COLUMN IF NOT EXISTS gas_price_diesel_cents integer,
  ADD COLUMN IF NOT EXISTS gas_price_updated_at timestamp,
  ADD COLUMN IF NOT EXISTS gas_price_source varchar DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_hosts_show_fuel_prices
  ON hosts(show_fuel_prices);
