import { sql, relations } from "drizzle-orm";
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
import { restaurants, users } from "./legacy";

export const jobPostings = pgTable(
  "job_postings",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    restaurantId: varchar("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    postedByUserId: varchar("posted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 160 }).notNull(),
    roleType: varchar("role_type", { length: 80 }).notNull().default("other"),
    employmentType: varchar("employment_type", { length: 80 })
      .notNull()
      .default("part_time"),
    description: text("description"),
    requirements: text("requirements"),
    scheduleDescription: text("schedule_description"),
    compensationLabel: varchar("compensation_label", { length: 140 }),
    payMinCents: integer("pay_min_cents"),
    payMaxCents: integer("pay_max_cents"),
    locationLabel: varchar("location_label", { length: 180 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 80 }),
    isRemoteFriendly: boolean("is_remote_friendly").notNull().default(false),
    positionsAvailable: integer("positions_available").notNull().default(1),
    status: varchar("status", { length: 40 }).notNull().default("open"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_job_postings_restaurant").on(table.restaurantId),
    index("idx_job_postings_status").on(table.status),
    index("idx_job_postings_city_state").on(table.city, table.state),
    index("idx_job_postings_role_type").on(table.roleType),
    index("idx_job_postings_created").on(table.createdAt),
  ],
);

export const jobApplications = pgTable(
  "job_applications",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobId: varchar("job_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    restaurantId: varchar("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    applicantUserId: varchar("applicant_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    applicantName: varchar("applicant_name", { length: 160 }).notNull(),
    applicantEmail: varchar("applicant_email", { length: 220 }).notNull(),
    applicantPhone: varchar("applicant_phone", { length: 60 }),
    resumeUrl: varchar("resume_url"),
    resumeFileName: varchar("resume_file_name", { length: 220 }),
    resumeStoragePublicId: varchar("resume_storage_public_id"),
    coverNote: text("cover_note"),
    availability: text("availability"),
    experienceSummary: text("experience_summary"),
    status: varchar("status", { length: 40 }).notNull().default("new"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_job_applications_job").on(table.jobId),
    index("idx_job_applications_restaurant").on(table.restaurantId),
    index("idx_job_applications_status").on(table.status),
    index("idx_job_applications_created").on(table.createdAt),
    index("idx_job_applications_email").on(table.applicantEmail),
  ],
);

export const jobPostingsRelations = relations(jobPostings, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [jobPostings.restaurantId],
    references: [restaurants.id],
  }),
  postedBy: one(users, {
    fields: [jobPostings.postedByUserId],
    references: [users.id],
  }),
  applications: many(jobApplications),
}));

export const jobApplicationsRelations = relations(
  jobApplications,
  ({ one }) => ({
    job: one(jobPostings, {
      fields: [jobApplications.jobId],
      references: [jobPostings.id],
    }),
    restaurant: one(restaurants, {
      fields: [jobApplications.restaurantId],
      references: [restaurants.id],
    }),
    applicant: one(users, {
      fields: [jobApplications.applicantUserId],
      references: [users.id],
    }),
  }),
);

export const insertJobPostingSchema = createInsertSchema(jobPostings);
export const insertJobApplicationSchema = createInsertSchema(jobApplications);

export type JobPosting = typeof jobPostings.$inferSelect;
export type InsertJobPosting = typeof jobPostings.$inferInsert;
export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;
