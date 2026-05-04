import { sql, relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { restaurants, users } from "./legacy";

export const businessConversations = pgTable(
  "business_conversations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    type: varchar("type").notNull().default("business_user"),
    subject: varchar("subject"),
    restaurantId: varchar("restaurant_id").references(() => restaurants.id, {
      onDelete: "set null",
    }),
    createdByUserId: varchar("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contextType: varchar("context_type"),
    contextId: varchar("context_id"),
    status: varchar("status").notNull().default("open"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastMessageAt: timestamp("last_message_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_business_conversations_restaurant").on(table.restaurantId),
    index("idx_business_conversations_status").on(table.status),
    index("idx_business_conversations_last_message").on(table.lastMessageAt),
    index("idx_business_conversations_context").on(
      table.contextType,
      table.contextId,
    ),
  ],
);

export const businessConversationParticipants = pgTable(
  "business_conversation_participants",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id")
      .notNull()
      .references(() => businessConversations.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    participantType: varchar("participant_type").notNull().default("user"),
    displayRole: varchar("display_role"),
    lastReadAt: timestamp("last_read_at"),
    archivedAt: timestamp("archived_at"),
    mutedAt: timestamp("muted_at"),
    joinedAt: timestamp("joined_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_business_conversation_participants_conversation").on(
      table.conversationId,
    ),
    index("idx_business_conversation_participants_user").on(table.userId),
    index("idx_business_conversation_participants_archived").on(
      table.archivedAt,
    ),
    unique("uq_business_conversation_participants_conversation_user").on(
      table.conversationId,
      table.userId,
    ),
  ],
);

export const businessMessages = pgTable(
  "business_messages",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id")
      .notNull()
      .references(() => businessConversations.id, { onDelete: "cascade" }),
    senderUserId: varchar("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    attachments: jsonb("attachments")
      .notNull()
      .default(sql`'[]'::jsonb`),
    isSystem: boolean("is_system").notNull().default(false),
    status: varchar("status").notNull().default("sent"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_business_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
    index("idx_business_messages_sender").on(table.senderUserId),
  ],
);

export const businessConversationsRelations = relations(
  businessConversations,
  ({ one, many }) => ({
    restaurant: one(restaurants, {
      fields: [businessConversations.restaurantId],
      references: [restaurants.id],
    }),
    createdBy: one(users, {
      fields: [businessConversations.createdByUserId],
      references: [users.id],
    }),
    participants: many(businessConversationParticipants),
    messages: many(businessMessages),
  }),
);

export const businessConversationParticipantsRelations = relations(
  businessConversationParticipants,
  ({ one }) => ({
    conversation: one(businessConversations, {
      fields: [businessConversationParticipants.conversationId],
      references: [businessConversations.id],
    }),
    user: one(users, {
      fields: [businessConversationParticipants.userId],
      references: [users.id],
    }),
  }),
);

export const businessMessagesRelations = relations(
  businessMessages,
  ({ one }) => ({
    conversation: one(businessConversations, {
      fields: [businessMessages.conversationId],
      references: [businessConversations.id],
    }),
    sender: one(users, {
      fields: [businessMessages.senderUserId],
      references: [users.id],
    }),
  }),
);

export const insertBusinessConversationSchema =
  createInsertSchema(businessConversations);
export const insertBusinessConversationParticipantSchema = createInsertSchema(
  businessConversationParticipants,
);
export const insertBusinessMessageSchema = createInsertSchema(businessMessages);

export type BusinessConversation =
  typeof businessConversations.$inferSelect;
export type InsertBusinessConversation =
  typeof businessConversations.$inferInsert;
export type BusinessConversationParticipant =
  typeof businessConversationParticipants.$inferSelect;
export type InsertBusinessConversationParticipant =
  typeof businessConversationParticipants.$inferInsert;
export type BusinessMessage = typeof businessMessages.$inferSelect;
export type InsertBusinessMessage = typeof businessMessages.$inferInsert;
