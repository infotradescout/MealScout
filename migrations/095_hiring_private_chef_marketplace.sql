-- Migration 095: generalized hiring marketplace and private chef lead flow

CREATE TABLE IF NOT EXISTS worker_profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name varchar NOT NULL,
  headline varchar,
  bio text,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  experience_level varchar DEFAULT 'experienced',
  service_cities jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  desired_rate_cents integer,
  resume_url varchar,
  portfolio_url varchar,
  phone varchar,
  email varchar,
  is_open_to_work boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  background_check_status varchar DEFAULT 'none',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_user
  ON worker_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_open_public
  ON worker_profiles(is_open_to_work, is_public);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_created
  ON worker_profiles(created_at);

CREATE TABLE IF NOT EXISTS job_posts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  posted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  title varchar NOT NULL,
  description text,
  role varchar NOT NULL,
  job_type varchar NOT NULL DEFAULT 'part_time',
  location_type varchar NOT NULL DEFAULT 'onsite',
  city varchar,
  state varchar,
  address varchar,
  schedule_description text,
  rate_min_cents integer,
  rate_max_cents integer,
  status varchar NOT NULL DEFAULT 'open',
  positions_available integer NOT NULL DEFAULT 1,
  starts_at timestamp,
  expires_at timestamp,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_posts_restaurant
  ON job_posts(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_job_posts_status_created
  ON job_posts(status, created_at);

CREATE INDEX IF NOT EXISTS idx_job_posts_city_state
  ON job_posts(city, state);

CREATE INDEX IF NOT EXISTS idx_job_posts_role
  ON job_posts(role);

CREATE TABLE IF NOT EXISTS job_applications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id varchar NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
  worker_profile_id varchar NOT NULL REFERENCES worker_profiles(id) ON DELETE CASCADE,
  applicant_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_note text,
  proposed_rate_cents integer,
  status varchar NOT NULL DEFAULT 'pending',
  responded_at timestamp,
  created_at timestamp DEFAULT now(),
  CONSTRAINT uq_job_applications_job_worker UNIQUE(job_id, worker_profile_id)
);

-- Drift guard: an earlier dormant jobs experiment may have created
-- job_applications with applicant/resume columns but without worker profiles.
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS worker_profile_id varchar REFERENCES worker_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS proposed_rate_cents integer,
  ADD COLUMN IF NOT EXISTS responded_at timestamp;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_applications'
      AND column_name = 'applicant_name'
  ) THEN
    ALTER TABLE job_applications ALTER COLUMN applicant_name DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_applications'
      AND column_name = 'applicant_email'
  ) THEN
    ALTER TABLE job_applications ALTER COLUMN applicant_email DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_applications'
      AND column_name = 'applicant_user_id'
  ) THEN
    ALTER TABLE job_applications ALTER COLUMN applicant_user_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_job_applications_job_worker'
  ) THEN
    ALTER TABLE job_applications
      ADD CONSTRAINT uq_job_applications_job_worker UNIQUE(job_id, worker_profile_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_applications_job
  ON job_applications(job_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_worker
  ON job_applications(worker_profile_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_applicant
  ON job_applications(applicant_user_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_status
  ON job_applications(status);

CREATE TABLE IF NOT EXISTS private_chef_leads (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  chef_restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  customer_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  customer_name varchar NOT NULL,
  customer_email varchar,
  customer_phone varchar,
  event_date timestamp,
  city varchar,
  state varchar,
  address varchar,
  guest_count integer,
  budget_cents integer,
  occasion varchar,
  dietary_needs text,
  notes text,
  status varchar NOT NULL DEFAULT 'new',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_chef_leads_chef
  ON private_chef_leads(chef_restaurant_id);

CREATE INDEX IF NOT EXISTS idx_private_chef_leads_customer
  ON private_chef_leads(customer_user_id);

CREATE INDEX IF NOT EXISTS idx_private_chef_leads_status
  ON private_chef_leads(status);

CREATE INDEX IF NOT EXISTS idx_private_chef_leads_created
  ON private_chef_leads(created_at);
