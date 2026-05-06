import { sql } from "drizzle-orm";

import { db } from "../db";

export async function ensureJobBoardSchema() {
  if (!db) return;

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_postings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id varchar REFERENCES restaurants(id) ON DELETE CASCADE,
        host_id varchar REFERENCES hosts(id) ON DELETE CASCADE,
        posted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        title varchar(160) NOT NULL,
        role_type varchar(80) NOT NULL DEFAULT 'other',
        employment_type varchar(80) NOT NULL DEFAULT 'part_time',
        description text,
        requirements text,
        schedule_description text,
        compensation_label varchar(140),
        pay_min_cents integer,
        pay_max_cents integer,
        location_label varchar(180),
        city varchar(120),
        state varchar(80),
        is_remote_friendly boolean NOT NULL DEFAULT false,
        positions_available integer NOT NULL DEFAULT 1,
        status varchar(40) NOT NULL DEFAULT 'open',
        expires_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_restaurant
      ON job_postings(restaurant_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_status
      ON job_postings(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_city_state
      ON job_postings(city, state)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_role_type
      ON job_postings(role_type)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_created
      ON job_postings(created_at)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_applications (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id varchar NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        restaurant_id varchar REFERENCES restaurants(id) ON DELETE CASCADE,
        host_id varchar REFERENCES hosts(id) ON DELETE CASCADE,
        applicant_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        applicant_name varchar(160) NOT NULL,
        applicant_email varchar(220) NOT NULL,
        applicant_phone varchar(60),
        resume_url varchar,
        resume_file_name varchar(220),
        resume_storage_public_id varchar,
        cover_note text,
        availability text,
        experience_summary text,
        status varchar(40) NOT NULL DEFAULT 'new',
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);

    await db.execute(sql`
      ALTER TABLE job_postings
      ADD COLUMN IF NOT EXISTS host_id varchar REFERENCES hosts(id) ON DELETE CASCADE
    `);
    await db.execute(sql`
      ALTER TABLE job_applications
      ADD COLUMN IF NOT EXISTS host_id varchar REFERENCES hosts(id) ON DELETE CASCADE
    `);
    await db.execute(sql`
      ALTER TABLE job_postings
      ALTER COLUMN restaurant_id DROP NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE job_applications
      ALTER COLUMN restaurant_id DROP NOT NULL
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_job_postings_single_business'
            AND conrelid = 'job_postings'::regclass
        ) THEN
          ALTER TABLE job_postings
            ADD CONSTRAINT chk_job_postings_single_business
            CHECK (
              ((restaurant_id IS NOT NULL)::int + (host_id IS NOT NULL)::int) = 1
            ) NOT VALID;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'chk_job_applications_single_business'
            AND conrelid = 'job_applications'::regclass
        ) THEN
          ALTER TABLE job_applications
            ADD CONSTRAINT chk_job_applications_single_business
            CHECK (
              ((restaurant_id IS NOT NULL)::int + (host_id IS NOT NULL)::int) = 1
            ) NOT VALID;
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_postings_host
      ON job_postings(host_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_host
      ON job_applications(host_id)
    `);

    await db.execute(sql`
      ALTER TABLE hosts
      ADD COLUMN IF NOT EXISTS show_fuel_prices boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS gas_price_regular_cents integer,
      ADD COLUMN IF NOT EXISTS gas_price_midgrade_cents integer,
      ADD COLUMN IF NOT EXISTS gas_price_premium_cents integer,
      ADD COLUMN IF NOT EXISTS gas_price_diesel_cents integer,
      ADD COLUMN IF NOT EXISTS gas_price_updated_at timestamp,
      ADD COLUMN IF NOT EXISTS gas_price_source varchar DEFAULT 'manual'
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_hosts_show_fuel_prices
      ON hosts(show_fuel_prices)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_job
      ON job_applications(job_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_restaurant
      ON job_applications(restaurant_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_status
      ON job_applications(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_created
      ON job_applications(created_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_applications_email
      ON job_applications(applicant_email)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_job_email_ci
      ON job_applications(job_id, lower(btrim(applicant_email)))
    `);

    console.log("[job-board-schema] ready");
  } catch (error) {
    console.warn(
      "[job-board-schema] compatibility check failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
