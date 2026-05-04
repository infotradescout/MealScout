CREATE TABLE IF NOT EXISTS job_postings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  posted_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  role_type VARCHAR(80) NOT NULL DEFAULT 'other',
  employment_type VARCHAR(80) NOT NULL DEFAULT 'part_time',
  description TEXT,
  requirements TEXT,
  schedule_description TEXT,
  compensation_label VARCHAR(140),
  pay_min_cents INTEGER,
  pay_max_cents INTEGER,
  location_label VARCHAR(180),
  city VARCHAR(120),
  state VARCHAR(80),
  is_remote_friendly BOOLEAN NOT NULL DEFAULT false,
  positions_available INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(40) NOT NULL DEFAULT 'open',
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_restaurant
  ON job_postings(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_job_postings_status
  ON job_postings(status);

CREATE INDEX IF NOT EXISTS idx_job_postings_city_state
  ON job_postings(city, state);

CREATE INDEX IF NOT EXISTS idx_job_postings_role_type
  ON job_postings(role_type);

CREATE INDEX IF NOT EXISTS idx_job_postings_created
  ON job_postings(created_at);

CREATE TABLE IF NOT EXISTS job_applications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  restaurant_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  applicant_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  applicant_name VARCHAR(160) NOT NULL,
  applicant_email VARCHAR(220) NOT NULL,
  applicant_phone VARCHAR(60),
  resume_url VARCHAR,
  resume_file_name VARCHAR(220),
  resume_storage_public_id VARCHAR,
  cover_note TEXT,
  availability TEXT,
  experience_summary TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_job
  ON job_applications(job_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_restaurant
  ON job_applications(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_job_applications_status
  ON job_applications(status);

CREATE INDEX IF NOT EXISTS idx_job_applications_created
  ON job_applications(created_at);

CREATE INDEX IF NOT EXISTS idx_job_applications_email
  ON job_applications(applicant_email);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_job_email_ci
  ON job_applications(job_id, lower(btrim(applicant_email)));
