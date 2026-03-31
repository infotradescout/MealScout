-- API client quota tiers for Price Scout external feed monetization.
-- This file intentionally avoids DO blocks because scripts/runSqlMigration.ts splits statements on semicolons.

CREATE TABLE IF NOT EXISTS "client_quotas" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tier" varchar(20) NOT NULL DEFAULT 'bronze',
  "rate_limit_per_hour" integer NOT NULL DEFAULT 60,
  "monthly_request_limit" integer NOT NULL DEFAULT 1000,
  "last_billing_cycle" timestamp DEFAULT now(),
  "current_monthly_usage" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_quotas_user"
  ON "client_quotas" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_client_quotas_user"
  ON "client_quotas" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_client_quotas_tier"
  ON "client_quotas" ("tier");
