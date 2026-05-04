CREATE TABLE IF NOT EXISTS "business_insurance_verifications" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" varchar(40) NOT NULL,
  "entity_id" varchar NOT NULL,
  "owner_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" varchar(40) NOT NULL DEFAULT 'pending',
  "jurisdiction_city" varchar(120),
  "jurisdiction_state" varchar(80),
  "jurisdiction_country" varchar(80) NOT NULL DEFAULT 'US',
  "carrier_name" varchar(180),
  "policy_number" varchar(120),
  "coverage_type" varchar(120) NOT NULL DEFAULT 'commercial_general_liability',
  "coverage_amount_cents" integer,
  "effective_date" timestamp,
  "expires_at" timestamp,
  "documents" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "attested_commercial_coverage" boolean NOT NULL DEFAULT false,
  "attested_jurisdiction_compliance" boolean NOT NULL DEFAULT false,
  "notes" text,
  "reviewer_notes" text,
  "reviewed_by" varchar REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_business_insurance_entity"
  ON "business_insurance_verifications" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_business_insurance_owner"
  ON "business_insurance_verifications" ("owner_id");

CREATE INDEX IF NOT EXISTS "idx_business_insurance_status"
  ON "business_insurance_verifications" ("status");

CREATE INDEX IF NOT EXISTS "idx_business_insurance_expiry"
  ON "business_insurance_verifications" ("expires_at");
