import { sql, relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { creditLedger, users } from "./legacy";

export const mealScoutCreditEvents = pgTable(
  "mealscout_credit_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 100 }).notNull(),
    sourceType: varchar("source_type", { length: 140 }).notNull(),
    sourceId: varchar("source_id", { length: 240 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: varchar("entity_id", { length: 120 }),
    creditAmountCents: integer("credit_amount_cents").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("credited"),
    creditLedgerId: varchar("credit_ledger_id").references(() => creditLedger.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_mealscout_credit_events_user").on(table.userId),
    index("idx_mealscout_credit_events_action").on(table.action),
    index("idx_mealscout_credit_events_source").on(
      table.sourceType,
      table.sourceId,
    ),
    index("idx_mealscout_credit_events_entity").on(
      table.entityType,
      table.entityId,
    ),
    index("idx_mealscout_credit_events_created").on(table.createdAt),
  ],
);

export const mealScoutCreditEventsRelations = relations(
  mealScoutCreditEvents,
  ({ one }) => ({
    user: one(users, {
      fields: [mealScoutCreditEvents.userId],
      references: [users.id],
    }),
    creditLedgerEntry: one(creditLedger, {
      fields: [mealScoutCreditEvents.creditLedgerId],
      references: [creditLedger.id],
    }),
  }),
);

export type MealScoutCreditEvent = typeof mealScoutCreditEvents.$inferSelect;
export type InsertMealScoutCreditEvent =
  typeof mealScoutCreditEvents.$inferInsert;
