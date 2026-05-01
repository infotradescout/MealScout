import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./legacy";

export const mediaOwnerTypes = [
  "user",
  "restaurant",
  "food_truck",
  "host",
  "event",
] as const;

export const mediaTypes = ["video"] as const;

export const mediaStatuses = [
  "processing",
  "active",
  "rejected",
  "deleted",
] as const;

export const mediaVisibilities = [
  "public",
  "private",
  "business_only",
] as const;

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerType: varchar("owner_type", { enum: mediaOwnerTypes }).notNull(),
    ownerId: varchar("owner_id").notNull(),
    mediaType: varchar("media_type", { enum: mediaTypes }).notNull().default("video"),
    title: varchar("title"),
    description: text("description"),
    fileUrl: text("file_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    status: varchar("status", { enum: mediaStatuses }).notNull().default("processing"),
    visibility: varchar("visibility", { enum: mediaVisibilities })
      .notNull()
      .default("public"),
    uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cloudinaryPublicId: varchar("cloudinary_public_id"),
    fileSize: integer("file_size"),
    mimeType: varchar("mime_type"),
    isFeatured: boolean("is_featured").notNull().default(false),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_media_assets_owner").on(table.ownerType, table.ownerId),
    index("idx_media_assets_public").on(
      table.ownerType,
      table.ownerId,
      table.mediaType,
      table.status,
      table.visibility,
    ),
    index("idx_media_assets_featured").on(
      table.ownerType,
      table.ownerId,
      table.isFeatured,
    ),
    index("idx_media_assets_uploaded_by").on(table.uploadedByUserId),
  ],
);

export const insertMediaAssetSchema = createInsertSchema(mediaAssets, {
  ownerType: z.enum(mediaOwnerTypes),
  mediaType: z.enum(mediaTypes).default("video"),
  status: z.enum(mediaStatuses).default("processing"),
  visibility: z.enum(mediaVisibilities).default("public"),
})
  .omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true })
  .extend({
    title: z.string().trim().max(140).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    ownerId: z.string().trim().min(1),
    fileUrl: z.string().trim().url(),
    thumbnailUrl: z.string().trim().url().optional().nullable(),
  });

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaOwnerType = (typeof mediaOwnerTypes)[number];
export type MediaStatus = (typeof mediaStatuses)[number];
export type MediaVisibility = (typeof mediaVisibilities)[number];
