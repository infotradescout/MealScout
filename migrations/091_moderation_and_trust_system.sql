-- 091: Moderation & Community Trust System
-- Support for flagging recommendations and business profile content
-- Tracks reporter reputation and moderation outcomes

-- Add reputation fields to users table
ALTER TABLE "users" ADD COLUMN "reporter_reputation_score" integer NOT NULL DEFAULT 100;
ALTER TABLE "users" ADD COLUMN "flagged_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "upheld_against_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "false_flag_count" integer NOT NULL DEFAULT 0;

-- Content flags: User reports inappropriate/spam/misleading recommendation
CREATE TABLE IF NOT EXISTS "recommendation_flags" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "recommendation_id" varchar NOT NULL,
  "flagged_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" varchar NOT NULL, -- 'spam', 'inappropriate', 'misleading', 'fake', 'off_topic', 'abuse'
  "description" text,
  "evidence_urls" jsonb DEFAULT '[]'::jsonb, -- URLs/screenshots supporting the flag
  "case_id" varchar REFERENCES "moderation_cases"("id") ON DELETE SET NULL,
  "flagged_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

-- Business profile content flags
CREATE TABLE IF NOT EXISTS "profile_content_flags" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "restaurant_id" varchar NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "flagged_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content_type" varchar NOT NULL, -- 'profile_description', 'hours', 'location', 'contact', 'images', 'other'
  "reason" varchar NOT NULL, -- 'false_info', 'inappropriate', 'misleading', 'policy_violation', 'spam', 'abuse'
  "description" text,
  "evidence_urls" jsonb DEFAULT '[]'::jsonb,
  "case_id" varchar REFERENCES "moderation_cases"("id") ON DELETE SET NULL,
  "flagged_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

-- Unified moderation case tracking
CREATE TABLE IF NOT EXISTS "moderation_cases" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_type" varchar NOT NULL, -- 'recommendation_flag' or 'profile_content_flag'
  "flag_id" varchar NOT NULL, -- References either recommendation_flags or profile_content_flags
  "status" varchar NOT NULL DEFAULT 'pending', -- 'pending', 'under_review', 'resolved', 'appealed'
  "restaurant_id" varchar REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "recommendation_id" varchar,
  "reporter_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_moderator_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "priority" varchar DEFAULT 'normal', -- 'urgent', 'normal', 'low'
  "assigned_at" timestamp,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

-- Moderation decisions and outcomes
CREATE TABLE IF NOT EXISTS "moderation_resolutions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL UNIQUE REFERENCES "moderation_cases"("id") ON DELETE CASCADE,
  "outcome" varchar NOT NULL, -- 'valid' (flag upheld), 'invalid' (flag dismissed), 'partial' (partial validity)
  "reason_code" varchar NOT NULL, -- 'genuine_violation', 'reporter_error', 'context_missing', 'borderline', 'insufficient_evidence'
  "moderator_notes" text,
  "action_taken" varchar, -- 'recommendation_hidden', 'recommendation_lowered', 'no_action', 'profile_updated', 'content_removed'
  "appeal_eligible" boolean DEFAULT true,
  "resolved_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

-- Appeal records (users can appeal moderator decisions)
CREATE TABLE IF NOT EXISTS "moderation_appeals" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "resolution_id" varchar NOT NULL UNIQUE REFERENCES "moderation_resolutions"("id") ON DELETE CASCADE,
  "appealed_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "appeal_reason" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'under_review'
  "appeal_moderator_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "appeal_resolution" text,
  "appealed_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" timestamp
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS "idx_recommendation_flags_case" ON "recommendation_flags"("case_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_flags_reporter" ON "recommendation_flags"("flagged_by_user_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_flags_recommendation" ON "recommendation_flags"("recommendation_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_flags_created" ON "recommendation_flags"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_profile_content_flags_case" ON "profile_content_flags"("case_id");
CREATE INDEX IF NOT EXISTS "idx_profile_content_flags_restaurant" ON "profile_content_flags"("restaurant_id");
CREATE INDEX IF NOT EXISTS "idx_profile_content_flags_reporter" ON "profile_content_flags"("flagged_by_user_id");
CREATE INDEX IF NOT EXISTS "idx_profile_content_flags_created" ON "profile_content_flags"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_moderation_cases_status" ON "moderation_cases"("status");
CREATE INDEX IF NOT EXISTS "idx_moderation_cases_reporter" ON "moderation_cases"("reporter_id");
CREATE INDEX IF NOT EXISTS "idx_moderation_cases_restaurant" ON "moderation_cases"("restaurant_id");
CREATE INDEX IF NOT EXISTS "idx_moderation_cases_moderator" ON "moderation_cases"("assigned_moderator_id");
CREATE INDEX IF NOT EXISTS "idx_moderation_cases_created" ON "moderation_cases"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_moderation_resolutions_case" ON "moderation_resolutions"("case_id");
CREATE INDEX IF NOT EXISTS "idx_moderation_resolutions_outcome" ON "moderation_resolutions"("outcome");

CREATE INDEX IF NOT EXISTS "idx_moderation_appeals_resolution" ON "moderation_appeals"("resolution_id");
CREATE INDEX IF NOT EXISTS "idx_moderation_appeals_appellant" ON "moderation_appeals"("appealed_by_user_id");
