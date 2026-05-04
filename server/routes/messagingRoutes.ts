import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import {
  businessConversationParticipants,
  businessConversations,
  businessMessages,
  restaurants,
  users,
} from "@shared/schema";
import { hasBusinessPermissionForRestaurant } from "../services/businessTeamAccess";

const startConversationSchema = z.object({
  restaurantId: z.string().trim().min(1).optional(),
  recipientUserId: z.string().trim().min(1).optional(),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4000),
  contextType: z.string().trim().max(80).optional(),
  contextId: z.string().trim().max(160).optional(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

type AuthUser = {
  id: string;
  userType?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

const elevatedRoles = new Set(["staff", "admin", "super_admin"]);

const rowsFrom = <T>(result: unknown): T[] => {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as any)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const normalizeOptional = (value: string | undefined) => {
  const clean = String(value || "").trim();
  return clean.length ? clean : undefined;
};

const isElevatedUser = (user: AuthUser | undefined | null) =>
  elevatedRoles.has(String(user?.userType || "").toLowerCase());

const displayNameSql = sql<string>`
  trim(concat(coalesce(u.first_name, ''), ' ', coalesce(u.last_name, '')))
`;

const participantTypeFor = (
  user: AuthUser,
  role: "customer" | "business" | "staff" | "admin",
) => {
  if (role === "admin") return "admin";
  if (role === "staff") return "staff";
  if (role === "business") return "business";
  const userType = String(user.userType || "").toLowerCase();
  return userType === "host" ? "host" : "customer";
};

async function getConversationAccess(
  conversationId: string,
  user: AuthUser,
) {
  const [conversation] = await db
    .select({
      id: businessConversations.id,
      restaurantId: businessConversations.restaurantId,
      status: businessConversations.status,
    })
    .from(businessConversations)
    .where(eq(businessConversations.id, conversationId))
    .limit(1);

  if (!conversation) return null;

  const [participant] = await db
    .select({
      id: businessConversationParticipants.id,
      userId: businessConversationParticipants.userId,
      archivedAt: businessConversationParticipants.archivedAt,
    })
    .from(businessConversationParticipants)
    .where(
      and(
        eq(businessConversationParticipants.conversationId, conversationId),
        eq(businessConversationParticipants.userId, user.id),
      ),
    )
    .limit(1);

  if (participant || isElevatedUser(user)) {
    return { conversation, participant: participant || null };
  }

  return null;
}

async function findOpenConversation(params: {
  restaurantId?: string;
  userId: string;
  counterpartyUserId: string;
  contextType?: string;
  contextId?: string;
}) {
  const contextType = normalizeOptional(params.contextType);
  const contextId = normalizeOptional(params.contextId);

  const result = await db.execute(sql`
    select c.id
    from business_conversations c
    where c.status = 'open'
      and (
        (${params.restaurantId ?? null}::varchar is null and c.restaurant_id is null)
        or c.restaurant_id = ${params.restaurantId ?? null}
      )
      and (
        ${contextType ?? null}::varchar is null
        or c.context_type = ${contextType}
      )
      and (
        ${contextId ?? null}::varchar is null
        or c.context_id = ${contextId}
      )
      and exists (
        select 1
        from business_conversation_participants p
        where p.conversation_id = c.id
          and p.user_id = ${params.userId}
      )
      and exists (
        select 1
        from business_conversation_participants p
        where p.conversation_id = c.id
          and p.user_id = ${params.counterpartyUserId}
      )
    order by c.last_message_at desc nulls last, c.created_at desc
    limit 1
  `);

  return rowsFrom<{ id: string }>(result)[0]?.id || null;
}

async function addMessage(params: {
  conversationId: string;
  senderUserId: string;
  body: string;
}) {
  const now = new Date();
  const [message] = await db
    .insert(businessMessages)
    .values({
      conversationId: params.conversationId,
      senderUserId: params.senderUserId,
      body: params.body,
      attachments: [],
      isSystem: false,
      status: "sent",
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();

  await db
    .update(businessConversations)
    .set({
      lastMessageAt: now,
      updatedAt: now,
      status: "open",
    } as any)
    .where(eq(businessConversations.id, params.conversationId));

  await db
    .update(businessConversationParticipants)
    .set({ archivedAt: null } as any)
    .where(
      eq(
        businessConversationParticipants.conversationId,
        params.conversationId,
      ),
    );

  await db
    .update(businessConversationParticipants)
    .set({ lastReadAt: now } as any)
    .where(
      and(
        eq(
          businessConversationParticipants.conversationId,
          params.conversationId,
        ),
        eq(businessConversationParticipants.userId, params.senderUserId),
      ),
    );

  return message;
}

async function getConversationPayload(conversationId: string) {
  const conversationResult = await db.execute(sql`
    select
      c.id,
      c.type,
      c.subject,
      c.restaurant_id as "restaurantId",
      c.created_by_user_id as "createdByUserId",
      c.context_type as "contextType",
      c.context_id as "contextId",
      c.status,
      c.metadata,
      c.last_message_at as "lastMessageAt",
      c.created_at as "createdAt",
      c.updated_at as "updatedAt",
      r.name as "restaurantName",
      r.business_type as "restaurantBusinessType",
      r.logo_url as "restaurantLogoUrl",
      r.cover_image_url as "restaurantCoverImageUrl"
    from business_conversations c
    left join restaurants r on r.id = c.restaurant_id
    where c.id = ${conversationId}
    limit 1
  `);

  const conversation = rowsFrom<Record<string, unknown>>(conversationResult)[0];
  if (!conversation) return null;

  const participantsResult = await db.execute(sql`
    select
      p.id,
      p.user_id as "userId",
      p.participant_type as "participantType",
      p.display_role as "displayRole",
      p.last_read_at as "lastReadAt",
      p.archived_at as "archivedAt",
      p.joined_at as "joinedAt",
      u.user_type as "userType",
      u.first_name as "firstName",
      u.last_name as "lastName",
      u.email,
      u.profile_image_url as "profileImageUrl",
      nullif(${displayNameSql}, '') as "name"
    from business_conversation_participants p
    join users u on u.id = p.user_id
    where p.conversation_id = ${conversationId}
    order by p.joined_at asc
  `);

  const messagesResult = await db.execute(sql`
    select
      m.id,
      m.conversation_id as "conversationId",
      m.sender_user_id as "senderUserId",
      m.body,
      m.attachments,
      m.is_system as "isSystem",
      m.status,
      m.created_at as "createdAt",
      m.updated_at as "updatedAt",
      u.user_type as "senderUserType",
      u.profile_image_url as "senderProfileImageUrl",
      nullif(${displayNameSql}, '') as "senderName"
    from business_messages m
    left join users u on u.id = m.sender_user_id
    where m.conversation_id = ${conversationId}
      and m.status = 'sent'
    order by m.created_at asc
  `);

  return {
    conversation,
    participants: rowsFrom<Record<string, unknown>>(participantsResult),
    messages: rowsFrom<Record<string, unknown>>(messagesResult),
  };
}

async function markRead(conversationId: string, userId: string) {
  await db
    .update(businessConversationParticipants)
    .set({ lastReadAt: new Date() } as any)
    .where(
      and(
        eq(businessConversationParticipants.conversationId, conversationId),
        eq(businessConversationParticipants.userId, userId),
      ),
    );
}

export function registerMessagingRoutes(app: Express) {
  app.get("/api/messages/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = String(req.user.id);
      const result = await db.execute(sql`
        select count(*)::int as count
        from business_conversation_participants p
        join business_messages m on m.conversation_id = p.conversation_id
        where p.user_id = ${userId}
          and p.archived_at is null
          and m.status = 'sent'
          and m.sender_user_id is distinct from ${userId}
          and (p.last_read_at is null or m.created_at > p.last_read_at)
      `);
      const count = Number(rowsFrom<{ count: number | string }>(result)[0]?.count || 0);
      res.json({ count });
    } catch (error) {
      console.error("[messages] Failed to load unread count", error);
      res.status(500).json({ message: "Failed to load message count" });
    }
  });

  app.get("/api/messages/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = String(req.user.id);
      const limit = Math.min(
        Math.max(Number(req.query.limit || 30) || 30, 1),
        60,
      );

      const result = await db.execute(sql`
        select
          c.id,
          c.type,
          c.subject,
          c.restaurant_id as "restaurantId",
          c.context_type as "contextType",
          c.context_id as "contextId",
          c.status,
          c.last_message_at as "lastMessageAt",
          c.created_at as "createdAt",
          c.updated_at as "updatedAt",
          r.name as "restaurantName",
          r.business_type as "restaurantBusinessType",
          r.logo_url as "restaurantLogoUrl",
          r.cover_image_url as "restaurantCoverImageUrl",
          latest.id as "latestMessageId",
          latest.body as "latestBody",
          latest.sender_user_id as "latestSenderUserId",
          latest.created_at as "latestCreatedAt",
          coalesce(unread.unread_count, 0)::int as "unreadCount",
          coalesce(participants.participants, '[]'::json) as participants
        from business_conversation_participants mine
        join business_conversations c on c.id = mine.conversation_id
        left join restaurants r on r.id = c.restaurant_id
        left join lateral (
          select m.id, m.body, m.sender_user_id, m.created_at
          from business_messages m
          where m.conversation_id = c.id
            and m.status = 'sent'
          order by m.created_at desc
          limit 1
        ) latest on true
        left join lateral (
          select count(*)::int as unread_count
          from business_messages m
          where m.conversation_id = c.id
            and m.status = 'sent'
            and m.sender_user_id is distinct from ${userId}
            and (mine.last_read_at is null or m.created_at > mine.last_read_at)
        ) unread on true
        left join lateral (
          select json_agg(
            json_build_object(
              'userId', p.user_id,
              'participantType', p.participant_type,
              'displayRole', p.display_role,
              'userType', u.user_type,
              'firstName', u.first_name,
              'lastName', u.last_name,
              'email', u.email,
              'profileImageUrl', u.profile_image_url,
              'name', nullif(trim(concat(coalesce(u.first_name, ''), ' ', coalesce(u.last_name, ''))), '')
            )
            order by p.joined_at asc
          ) as participants
          from business_conversation_participants p
          join users u on u.id = p.user_id
          where p.conversation_id = c.id
        ) participants on true
        where mine.user_id = ${userId}
          and mine.archived_at is null
          and c.status <> 'deleted'
        order by c.last_message_at desc nulls last, c.created_at desc
        limit ${limit}
      `);

      res.json({ conversations: rowsFrom<Record<string, unknown>>(result) });
    } catch (error) {
      console.error("[messages] Failed to load conversations", error);
      res.status(500).json({ message: "Failed to load conversations" });
    }
  });

  app.get(
    "/api/messages/conversations/:conversationId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const conversationId = String(req.params.conversationId || "");
        const access = await getConversationAccess(conversationId, req.user);
        if (!access) {
          return res.status(404).json({ message: "Conversation not found" });
        }

        if (access.participant) {
          await markRead(conversationId, String(req.user.id));
        }

        const payload = await getConversationPayload(conversationId);
        if (!payload) {
          return res.status(404).json({ message: "Conversation not found" });
        }
        res.json(payload);
      } catch (error) {
        console.error("[messages] Failed to load conversation", error);
        res.status(500).json({ message: "Failed to load conversation" });
      }
    },
  );

  app.post("/api/messages/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = startConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid conversation payload",
          errors: parsed.error.flatten(),
        });
      }

      const user = req.user as AuthUser;
      const senderUserId = String(user.id);
      const restaurantId = normalizeOptional(parsed.data.restaurantId);
      const recipientUserId = normalizeOptional(parsed.data.recipientUserId);
      const contextType = normalizeOptional(parsed.data.contextType);
      const contextId = normalizeOptional(parsed.data.contextId);
      const subject = normalizeOptional(parsed.data.subject);
      const body = parsed.data.body.trim();

      let counterpartyUserId = recipientUserId;
      let restaurantRow:
        | {
            id: string;
            name: string;
            ownerId: string;
            businessType: string | null;
          }
        | undefined;

      const participants = new Map<
        string,
        { userId: string; participantType: string; displayRole?: string }
      >();

      const addParticipant = (
        userId: string,
        participantType: string,
        displayRole?: string,
      ) => {
        if (!userId) return;
        participants.set(userId, { userId, participantType, displayRole });
      };

      if (restaurantId) {
        const [restaurant] = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            ownerId: restaurants.ownerId,
            businessType: restaurants.businessType,
          })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);

        if (!restaurant) {
          return res.status(404).json({ message: "Business not found" });
        }

        restaurantRow = restaurant;

        const canRepresentBusiness =
          isElevatedUser(user) ||
          (await hasBusinessPermissionForRestaurant(
            senderUserId,
            restaurant.id,
            "manageProfile",
          ));

        if (canRepresentBusiness) {
          if (!recipientUserId) {
            return res.status(400).json({
              message: "Choose a user before starting a business message.",
            });
          }
          counterpartyUserId = recipientUserId;
          addParticipant(
            senderUserId,
            participantTypeFor(
              user,
              isElevatedUser(user)
                ? String(user.userType).includes("admin")
                  ? "admin"
                  : "staff"
                : "business",
            ),
            isElevatedUser(user) ? "MealScout team" : restaurant.name,
          );
          addParticipant(restaurant.ownerId, "business", restaurant.name);
          addParticipant(recipientUserId, "customer");
        } else {
          counterpartyUserId = restaurant.ownerId;
          addParticipant(senderUserId, participantTypeFor(user, "customer"));
          addParticipant(restaurant.ownerId, "business", restaurant.name);
        }
      } else if (recipientUserId && isElevatedUser(user)) {
        addParticipant(
          senderUserId,
          participantTypeFor(
            user,
            String(user.userType || "").includes("admin") ? "admin" : "staff",
          ),
          "MealScout team",
        );
        addParticipant(recipientUserId, "customer");
      } else {
        return res.status(400).json({
          message: "Choose a business or recipient before starting a message.",
        });
      }

      if (!counterpartyUserId || counterpartyUserId === senderUserId) {
        return res.status(400).json({
          message: "Choose someone else to message.",
        });
      }

      const [recipientExists] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, counterpartyUserId))
        .limit(1);
      if (!recipientExists) {
        return res.status(404).json({ message: "Recipient not found" });
      }

      const existingId = await findOpenConversation({
        restaurantId,
        userId: senderUserId,
        counterpartyUserId,
        contextType,
        contextId,
      });

      if (existingId) {
        await addMessage({
          conversationId: existingId,
          senderUserId,
          body,
        });
        return res.status(200).json({ conversationId: existingId });
      }

      const created = await db.transaction(async (tx: any) => {
        const now = new Date();
        const [conversation] = await tx
          .insert(businessConversations)
          .values({
            type: "business_user",
            subject:
              subject ||
              (restaurantRow?.name ? `Message ${restaurantRow.name}` : "Message"),
            restaurantId: restaurantRow?.id || null,
            createdByUserId: senderUserId,
            contextType: contextType || null,
            contextId: contextId || null,
            status: "open",
            metadata: {},
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning();

        const participantRows = Array.from(participants.values()).map((p) => ({
          conversationId: conversation.id,
          userId: p.userId,
          participantType: p.participantType,
          displayRole: p.displayRole || null,
          lastReadAt: p.userId === senderUserId ? now : null,
          joinedAt: now,
          createdAt: now,
        }));

        await tx.insert(businessConversationParticipants).values(participantRows);
        await tx.insert(businessMessages).values({
          conversationId: conversation.id,
          senderUserId,
          body,
          attachments: [],
          isSystem: false,
          status: "sent",
          createdAt: now,
          updatedAt: now,
        } as any);

        return conversation;
      });

      res.status(201).json({ conversationId: created.id });
    } catch (error) {
      console.error("[messages] Failed to start conversation", error);
      res.status(500).json({ message: "Failed to start conversation" });
    }
  });

  app.post(
    "/api/messages/conversations/:conversationId/messages",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const parsed = sendMessageSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Invalid message",
            errors: parsed.error.flatten(),
          });
        }

        const conversationId = String(req.params.conversationId || "");
        const access = await getConversationAccess(conversationId, req.user);
        if (!access) {
          return res.status(404).json({ message: "Conversation not found" });
        }

        const message = await addMessage({
          conversationId,
          senderUserId: String(req.user.id),
          body: parsed.data.body.trim(),
        });

        res.status(201).json({ message });
      } catch (error) {
        console.error("[messages] Failed to send message", error);
        res.status(500).json({ message: "Failed to send message" });
      }
    },
  );

  app.patch(
    "/api/messages/conversations/:conversationId/read",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const conversationId = String(req.params.conversationId || "");
        const access = await getConversationAccess(conversationId, req.user);
        if (!access?.participant) {
          return res.status(404).json({ message: "Conversation not found" });
        }
        await markRead(conversationId, String(req.user.id));
        res.json({ ok: true });
      } catch (error) {
        console.error("[messages] Failed to mark read", error);
        res.status(500).json({ message: "Failed to mark read" });
      }
    },
  );

  app.patch(
    "/api/messages/conversations/:conversationId/archive",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const conversationId = String(req.params.conversationId || "");
        const access = await getConversationAccess(conversationId, req.user);
        if (!access?.participant) {
          return res.status(404).json({ message: "Conversation not found" });
        }

        await db
          .update(businessConversationParticipants)
          .set({ archivedAt: new Date() } as any)
          .where(
            and(
              eq(
                businessConversationParticipants.conversationId,
                conversationId,
              ),
              eq(businessConversationParticipants.userId, String(req.user.id)),
            ),
          );

        res.json({ ok: true });
      } catch (error) {
        console.error("[messages] Failed to archive conversation", error);
        res.status(500).json({ message: "Failed to archive conversation" });
      }
    },
  );
}
