import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../unifiedAuth";
import {
  listInAppNotifications,
  markInAppNotificationRead,
} from "../productNotifications";

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
}
