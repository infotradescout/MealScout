import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, restaurants, restaurantUserRecommendations } from "./legacy";

// Recommendation flags: User reports a recommendation as spam/inappropriate/misleading
export const recommendationFlags = pgTable(
  "recommendation_flags",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    recommendationId: varchar("recommendation_id").notNull(),
    flaggedByUserId: varchar("flagged_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason").notNull(), // 'spam', 'inappropriate', 'misleading', 'fake', 'off_topic', 'abuse'
    description: text("description"),
    evidenceUrls: jsonb("evidence_urls")
      .notNull()
      .default(sql`'[]'::jsonb`), // URLs/screenshots
    caseId: varchar("case_id").references(() => moderationCases.id, {
      onDelete: "set null",
    }),
    flaggedAt: timestamp("flagged_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_recommendation_flags_case").on(table.caseId),
    index("idx_recommendation_flags_reporter").on(table.flaggedByUserId),
    index("idx_recommendation_flags_recommendation").on(table.recommendationId),
    index("idx_recommendation_flags_created").on(table.createdAt.desc()),
  ],
);

// Profile content flags: User reports business profile content as false/inappropriate
export const profileContentFlags = pgTable(
  "profile_content_flags",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    restaurantId: varchar("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    flaggedByUserId: varchar("flagged_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: varchar("content_type").notNull(), // 'profile_description', 'hours', 'location', 'contact', 'images', 'other'
    reason: varchar("reason").notNull(), // 'false_info', 'inappropriate', 'misleading', 'policy_violation', 'spam', 'abuse'
    description: text("description"),
    evidenceUrls: jsonb("evidence_urls")
      .notNull()
      .default(sql`'[]'::jsonb`),
    caseId: varchar("case_id").references(() => moderationCases.id, {
      onDelete: "set null",
    }),
    flaggedAt: timestamp("flagged_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_profile_content_flags_case").on(table.caseId),
    index("idx_profile_content_flags_restaurant").on(table.restaurantId),
    index("idx_profile_content_flags_reporter").on(table.flaggedByUserId),
    index("idx_profile_content_flags_created").on(table.createdAt.desc()),
  ],
);

// Unified moderation case tracking
export const moderationCases = pgTable(
  "moderation_cases",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    caseType: varchar("case_type").notNull(), // 'recommendation_flag' or 'profile_content_flag'
    flagId: varchar("flag_id").notNull(), // References either recommendation_flags or profile_content_flags
    status: varchar("status")
      .notNull()
      .default("pending"), // 'pending', 'under_review', 'resolved', 'appealed'
    restaurantId: varchar("restaurant_id").references(() => restaurants.id, {
      onDelete: "cascade",
    }),
    recommendationId: varchar("recommendation_id"),
    reporterId: varchar("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedModeratorId: varchar("assigned_moderator_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    priority: varchar("priority").default("normal"), // 'urgent', 'normal', 'low'
    assignedAt: timestamp("assigned_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_moderation_cases_status").on(table.status),
    index("idx_moderation_cases_reporter").on(table.reporterId),
    index("idx_moderation_cases_restaurant").on(table.restaurantId),
    index("idx_moderation_cases_moderator").on(table.assignedModeratorId),
    index("idx_moderation_cases_created").on(table.createdAt.desc()),
  ],
);

// Moderation decisions and outcomes
export const moderationResolutions = pgTable(
  "moderation_resolutions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    caseId: varchar("case_id")
      .notNull()
      .unique()
      .references(() => moderationCases.id, { onDelete: "cascade" }),
    outcome: varchar("outcome").notNull(), // 'valid' (upheld), 'invalid' (dismissed), 'partial'
    reasonCode: varchar("reason_code").notNull(), // 'genuine_violation', 'reporter_error', 'context_missing', 'borderline', 'insufficient_evidence'
    moderatorNotes: text("moderator_notes"),
    actionTaken: varchar("action_taken"), // 'recommendation_hidden', 'recommendation_lowered', 'no_action', 'profile_updated', 'content_removed'
    appealEligible: boolean("appeal_eligible").default(true),
    resolvedAt: timestamp("resolved_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_moderation_resolutions_case").on(table.caseId),
    index("idx_moderation_resolutions_outcome").on(table.outcome),
  ],
);

// Appeal records: Users can appeal moderator decisions
export const moderationAppeals = pgTable(
  "moderation_appeals",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    resolutionId: varchar("resolution_id")
      .notNull()
      .unique()
      .references(() => moderationResolutions.id, { onDelete: "cascade" }),
    appealedByUserId: varchar("appealed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appealReason: text("appeal_reason").notNull(),
    status: varchar("status")
      .notNull()
      .default("pending"), // 'pending', 'approved', 'denied', 'under_review'
    appealModeratorId: varchar("appeal_moderator_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    appealResolution: text("appeal_resolution"),
    appealedAt: timestamp("appealed_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_moderation_appeals_resolution").on(table.resolutionId),
    index("idx_moderation_appeals_appellant").on(table.appealedByUserId),
  ],
);

// Relations
export const recommendationFlagsRelations = relations(
  recommendationFlags,
  ({ one }) => ({
    reporter: one(users, {
      fields: [recommendationFlags.flaggedByUserId],
      references: [users.id],
    }),
    case: one(moderationCases, {
      fields: [recommendationFlags.caseId],
      references: [moderationCases.id],
    }),
  }),
);

export const profileContentFlagsRelations = relations(
  profileContentFlags,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [profileContentFlags.restaurantId],
      references: [restaurants.id],
    }),
    reporter: one(users, {
      fields: [profileContentFlags.flaggedByUserId],
      references: [users.id],
    }),
    case: one(moderationCases, {
      fields: [profileContentFlags.caseId],
      references: [moderationCases.id],
    }),
  }),
);

export const moderationCasesRelations = relations(
  moderationCases,
  ({ one, many }) => ({
    reporter: one(users, {
      fields: [moderationCases.reporterId],
      references: [users.id],
    }),
    assignedModerator: one(users, {
      fields: [moderationCases.assignedModeratorId],
      references: [users.id],
    }),
    restaurant: one(restaurants, {
      fields: [moderationCases.restaurantId],
      references: [restaurants.id],
    }),
    resolution: one(moderationResolutions, {
      fields: [moderationCases.id],
      references: [moderationResolutions.caseId],
    }),
  }),
);

export const moderationResolutionsRelations = relations(
  moderationResolutions,
  ({ one, many }) => ({
    case: one(moderationCases, {
      fields: [moderationResolutions.caseId],
      references: [moderationCases.id],
    }),
    appeal: one(moderationAppeals, {
      fields: [moderationResolutions.id],
      references: [moderationAppeals.resolutionId],
    }),
  }),
);

export const moderationAppealsRelations = relations(
  moderationAppeals,
  ({ one }) => ({
    resolution: one(moderationResolutions, {
      fields: [moderationAppeals.resolutionId],
      references: [moderationResolutions.id],
    }),
    appellant: one(users, {
      fields: [moderationAppeals.appealedByUserId],
      references: [users.id],
    }),
    appealModerator: one(users, {
      fields: [moderationAppeals.appealModeratorId],
      references: [users.id],
    }),
  }),
);

// Zod schemas for validation
export const insertRecommendationFlagSchema = createInsertSchema(
  recommendationFlags,
).pick({
  recommendationId: true,
  reason: true,
  description: true,
  evidenceUrls: true,
});

export const insertProfileContentFlagSchema = createInsertSchema(
  profileContentFlags,
).pick({
  restaurantId: true,
  contentType: true,
  reason: true,
  description: true,
  evidenceUrls: true,
});

export const insertModerationResolutionSchema = createInsertSchema(
  moderationResolutions,
).pick({
  caseId: true,
  outcome: true,
  reasonCode: true,
  moderatorNotes: true,
  actionTaken: true,
});

export const insertModerationAppealSchema = createInsertSchema(
  moderationAppeals,
).pick({
  resolutionId: true,
  appealReason: true,
});

// Export types
export type RecommendationFlag = typeof recommendationFlags.$inferSelect;
export type InsertRecommendationFlag = typeof recommendationFlags.$inferInsert;
export type ProfileContentFlag = typeof profileContentFlags.$inferSelect;
export type InsertProfileContentFlag = typeof profileContentFlags.$inferInsert;
export type ModerationCase = typeof moderationCases.$inferSelect;
export type InsertModerationCase = typeof moderationCases.$inferInsert;
export type ModerationResolution = typeof moderationResolutions.$inferSelect;
export type InsertModerationResolution =
  typeof moderationResolutions.$inferInsert;
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
export type InsertModerationAppeal = typeof moderationAppeals.$inferInsert;
