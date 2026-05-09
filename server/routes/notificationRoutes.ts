import type { Express } from "express";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isAuthenticated } from "../unifiedAuth";
import { db } from "../db";
import { storage } from "../storage";
import { isAdminUserType } from "../roleAccess";
import {
  listInAppNotifications,
  markInAppNotificationRead,
  notifyUser,
} from "../productNotifications";
import { telemetryEvents } from "@shared/schema";

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit || "50"), 10);
      const rows = await listInAppNotifications(String(req.user.id), limit);
      res.json({
        notifications: rows.map((row: any) => {
          const properties = row.properties || {};
          return {
            id: properties.notificationId || row.id,
            title: properties.title || "MealScout update",
            body: properties.body || "",
            topic: properties.topic || "general",
            actionUrl: properties.actionUrl || null,
            priority: properties.priority || "normal",
            sourceType: properties.sourceType || null,
            sourceId: properties.sourceId || null,
            metadata: properties.metadata || {},
            channels: properties.channels || {},
            createdAt: row.createdAt,
            isRead: Boolean(row.isRead),
          };
        }),
      });
    } catch (error) {
      console.error("Error loading notifications:", error);
      res.status(500).json({ message: "Failed to load notifications" });
    }
  });

  app.post(
    "/api/notifications/:notificationId/read",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const parsed = z
          .object({ notificationId: z.string().min(3).max(120) })
          .parse(req.params);
        await markInAppNotificationRead(
          String(req.user.id),
          parsed.notificationId,
        );
        res.json({ ok: true });
      } catch (error) {
        console.error("Error marking notification read:", error);
        res.status(400).json({ message: "Failed to mark notification read" });
      }
    },
  );

  app.post("/api/connections/request", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = z
        .object({
          targetUserId: z.string().min(6).max(120),
          message: z.string().max(300).optional(),
          contextType: z.string().max(60).optional(),
          contextId: z.string().max(120).optional(),
        })
        .parse(req.body || {});
      const requesterId = String(req.user.id);
      if (parsed.targetUserId === requesterId) {
        return res.status(400).json({ message: "You cannot connect with yourself" });
      }

      const [requester, target] = await Promise.all([
        storage.getUser(requesterId),
        storage.getUser(parsed.targetUserId),
      ]);
      if (!requester || !target) {
        return res.status(404).json({ message: "User not found" });
      }

      const requestId = randomUUID();
      const isPlatformSupport = isAdminUserType(requester.userType);
      const requesterName =
        [requester.firstName, requester.lastName].filter(Boolean).join(" ") ||
        requester.email ||
        (isPlatformSupport ? "MealScout Support" : "A MealScout user");
      const safeMessage = String(parsed.message || "").trim();

      await db.insert(telemetryEvents).values({
        eventName: isPlatformSupport
          ? "platform_support_connection_created"
          : "user_connection_request_created",
        userId: requesterId,
        properties: {
          requestId,
          targetUserId: parsed.targetUserId,
          contextType: parsed.contextType || null,
          contextId: parsed.contextId || null,
          hasMessage: Boolean(safeMessage),
          status: isPlatformSupport ? "accepted" : "pending",
          requesterUserType: requester.userType || null,
        },
      });

      const notification = await notifyUser({
        user: target,
        topic: "businessMessages",
        title: isPlatformSupport
          ? `${requesterName} can help you on MealScout`
          : `${requesterName} wants to connect`,
        body: isPlatformSupport
          ? safeMessage ||
            "This is a real MealScout team account. You can message this account for help with your profile, business setup, listings, or account questions."
          : safeMessage ||
            "Review this MealScout connection request before sharing more access.",
        priority: "high",
        sourceType: isPlatformSupport
          ? "platform_support_connection"
          : "connection_request",
        sourceId: requestId,
        actorUserId: requesterId,
        channels: ["in_app", "email"],
        metadata: {
          requestId,
          requesterId,
          requesterName,
          contextType: parsed.contextType || null,
          contextId: parsed.contextId || null,
          status: isPlatformSupport ? "accepted" : "pending",
          supportAccount: isPlatformSupport,
          requesterUserType: requester.userType || null,
        },
      });

      res.status(201).json({
        ok: true,
        requestId,
        notificationId: notification.notificationId,
        status: isPlatformSupport ? "accepted" : "pending",
      });
    } catch (error: any) {
      console.error("Error creating connection request:", error);
      res.status(400).json({ message: error?.message || "Failed to create request" });
    }
  });

  app.post(
    "/api/connections/:requestId/respond",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const params = z
          .object({ requestId: z.string().min(8).max(120) })
          .parse(req.params);
        const body = z
          .object({ decision: z.enum(["accepted", "denied"]) })
          .parse(req.body || {});
        const targetUserId = String(req.user.id);
        const requestRows = await db.execute(sql`
          select
            properties->>'actorUserId' as "requesterId",
            properties->'metadata'->>'requesterName' as "requesterName",
            properties->>'notificationId' as "notificationId"
          from telemetry_events
          where event_name = 'product_notification'
            and user_id = ${targetUserId}
            and properties->>'sourceType' = 'connection_request'
            and properties->>'sourceId' = ${params.requestId}
          order by created_at desc
          limit 1
        `);
        const requestRow = Array.isArray((requestRows as any).rows)
          ? (requestRows as any).rows[0]
          : null;
        if (!requestRow?.requesterId) {
          return res.status(404).json({ message: "Connection request not found" });
        }

        await db.insert(telemetryEvents).values({
          eventName: `user_connection_request_${body.decision}`,
          userId: targetUserId,
          properties: {
            requestId: params.requestId,
            requesterId: requestRow.requesterId,
            targetUserId,
            decision: body.decision,
          },
        });

        if (requestRow.notificationId) {
          await markInAppNotificationRead(targetUserId, requestRow.notificationId);
        }

        const requester = await storage.getUser(String(requestRow.requesterId));
        const target = await storage.getUser(targetUserId);
        if (requester) {
          const targetName =
            [target?.firstName, target?.lastName].filter(Boolean).join(" ") ||
            target?.email ||
            "That MealScout user";
          await notifyUser({
            user: requester,
            topic: "businessMessages",
            title:
              body.decision === "accepted"
                ? `${targetName} accepted your connection request`
                : `${targetName} declined your connection request`,
            body:
              body.decision === "accepted"
                ? "You can continue the conversation in MealScout."
                : "No worries. MealScout will not share additional access from this request.",
            priority: "normal",
            sourceType: "connection_request_response",
            sourceId: params.requestId,
            actorUserId: targetUserId,
            channels: ["in_app", "email"],
            metadata: {
              requestId: params.requestId,
              targetUserId,
              decision: body.decision,
            },
          });
        }

        res.json({ ok: true, decision: body.decision });
      } catch (error: any) {
        console.error("Error responding to connection request:", error);
        res.status(400).json({ message: error?.message || "Failed to respond" });
      }
    },
  );
}
