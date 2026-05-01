CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" varchar NOT NULL,
  "owner_id" varchar NOT NULL,
  "media_type" varchar DEFAULT 'video' NOT NULL,
  "title" varchar,
  "description" text,
  "file_url" text NOT NULL,
  "thumbnail_url" text,
  "duration_seconds" integer,
  "status" varchar DEFAULT 'processing' NOT NULL,
  "visibility" varchar DEFAULT 'public' NOT NULL,
  "uploaded_by_user_id" varchar,
  "cloudinary_public_id" varchar,
  "file_size" integer,
  "mime_type" varchar,
  "is_featured" boolean DEFAULT false NOT NULL,
  "rejection_reason" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "deleted_at" timestamp,
  CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "ck_media_assets_owner_type"
    CHECK ("owner_type" IN ('user', 'restaurant', 'food_truck', 'host', 'event')),
  CONSTRAINT "ck_media_assets_media_type"
    CHECK ("media_type" IN ('video')),
  CONSTRAINT "ck_media_assets_status"
    CHECK ("status" IN ('processing', 'active', 'rejected', 'deleted')),
  CONSTRAINT "ck_media_assets_visibility"
    CHECK ("visibility" IN ('public', 'private', 'business_only'))
);

CREATE INDEX IF NOT EXISTS "idx_media_assets_owner"
  ON "media_assets" ("owner_type", "owner_id");

CREATE INDEX IF NOT EXISTS "idx_media_assets_public"
  ON "media_assets" ("owner_type", "owner_id", "media_type", "status", "visibility");

CREATE INDEX IF NOT EXISTS "idx_media_assets_featured"
  ON "media_assets" ("owner_type", "owner_id", "is_featured");

CREATE INDEX IF NOT EXISTS "idx_media_assets_uploaded_by"
  ON "media_assets" ("uploaded_by_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_assets_one_featured_video_per_owner"
  ON "media_assets" ("owner_type", "owner_id")
  WHERE "media_type" = 'video'
    AND "is_featured" = true
    AND "status" <> 'deleted';
