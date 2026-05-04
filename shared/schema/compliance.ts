import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { users } from "./users";

export const businessInsuranceVerifications = pgTable(
  "business_insurance_verifications",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entityType: varchar("entity_type", { length: 40 }).notNull(), // restaurant | food_truck | host
    entityId: varchar("entity_id").notNull(),
    ownerId: varchar("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 40 }).notNull().default("pending"), // pending | approved | rejected | expired
    jurisdictionCity: varchar("jurisdiction_city", { length: 120 }),
    jurisdictionState: varchar("jurisdiction_state", { length: 80 }),
    jurisdictionCountry: varchar("jurisdiction_country", { length: 80 })
      .notNull()
      .default("US"),
    carrierName: varchar("carrier_name", { length: 180 }),
    policyNumber: varchar("policy_number", { length: 120 }),
    coverageType: varchar("coverage_type", { length: 120 })
      .notNull()
      .default("commercial_general_liability"),
    coverageAmountCents: integer("coverage_amount_cents"),
    effectiveDate: timestamp("effective_date"),
    expiresAt: timestamp("expires_at"),
    documents: text("documents").array().notNull().default(sql`ARRAY[]::text[]`),
    attestedCommercialCoverage: boolean("attested_commercial_coverage")
      .notNull()
      .default(false),
    attestedJurisdictionCompliance: boolean(
      "attested_jurisdiction_compliance",
    )
      .notNull()
      .default(false),
    notes: text("notes"),
    reviewerNotes: text("reviewer_notes"),
    reviewedBy: varchar("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_business_insurance_entity").on(table.entityType, table.entityId),
    index("idx_business_insurance_owner").on(table.ownerId),
    index("idx_business_insurance_status").on(table.status),
    index("idx_business_insurance_expiry").on(table.expiresAt),
  ],
);

export const insertBusinessInsuranceVerificationSchema = createInsertSchema(
  businessInsuranceVerifications,
)
  .omit({
    id: true,
    status: true,
    reviewerNotes: true,
    reviewedBy: true,
    reviewedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    entityType: z.enum(["restaurant", "food_truck", "host"]),
    entityId: z.string().min(1),
    documents: z.array(z.string()).min(1).max(5),
    jurisdictionCity: z.string().trim().max(120).optional().nullable(),
    jurisdictionState: z.string().trim().max(80).optional().nullable(),
    jurisdictionCountry: z.string().trim().max(80).optional().default("US"),
    carrierName: z.string().trim().max(180).optional().nullable(),
    policyNumber: z.string().trim().max(120).optional().nullable(),
    coverageType: z
      .string()
      .trim()
      .max(120)
      .optional()
      .default("commercial_general_liability"),
    coverageAmountCents: z.number().int().nonnegative().optional().nullable(),
    effectiveDate: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date(),
    attestedCommercialCoverage: z.literal(true),
    attestedJurisdictionCompliance: z.literal(true),
    notes: z.string().trim().max(2000).optional().nullable(),
  });

export type BusinessInsuranceVerification =
  typeof businessInsuranceVerifications.$inferSelect;
export type InsertBusinessInsuranceVerification = z.infer<
  typeof insertBusinessInsuranceVerificationSchema
>;
