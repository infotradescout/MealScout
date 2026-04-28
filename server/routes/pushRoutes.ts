import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { storage } from "../storage";
import {
  ensurePushConfigured,
  getPublicVapidKey,
  getPushConfigSummary,
  sendPushNotification,
} from "../pushService";

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

type PushSubscriptionRecord = z.infer<typeof pushSubscriptionSchema> & {
  createdAt: string;
  lastUsedAt?: string;
  userAgent?: string | null;
};

const getSubscriptions = (settings: any): PushSubscriptionRecord[] => {
  const rows = settings?.notifications?.pushSubscriptions;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => {
      const parsed = pushSubscriptionSchema.safeParse(row);
      if (!parsed.success) return null;
      return {
        ...parsed.data,
        createdAt:
          typeof row?.createdAt === "string"
            ? row.createdAt
            : new Date().toISOString(),
        lastUsedAt:
          typeof row?.lastUsedAt === "string" ? row.lastUsedAt : undefined,
        userAgent:
          typeof row?.userAgent === "string" ? row.userAgent : undefined,
      };
    })
    .filter(Boolean) as PushSubscriptionRecord[];
};

const putSubscriptions = (settings: any, subscriptions: PushSubscriptionRecord[]) => {
  const nextSettings = {
    ...(settings || {}),
    notifications: {
      ...((settings || {}).notifications || {}),
      pushSubscriptions: subscriptions,
    },
  };
  return nextSettings;
};

export function registerPushRoutes(app: Express) {
  app.get("/api/notifications/push/public-key", (_req, res) => {
    const key = getPublicVapidKey();
    if (!key) {
      return res.status(503).json({ message: "Push notifications are not configured" });
    }
    return res.json({ publicKey: key });
  });

  app.get("/api/notifications/push/status", isAuthenticated, async (_req: any, res) => {
    return res.json(getPushConfigSummary());
  });

  app.post(
    "/api/notifications/push/subscribe",
    isAuthenticated,
    async (req: any, res) => {
      if (!ensurePushConfigured()) {
        return res.status(503).json({ message: "Push notifications are not configured" });
      }

      const parsed = pushSubscriptionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid push subscription payload" });
      }

      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentSubscriptions = getSubscriptions(user.accountSettings || {});
      const deduped = currentSubscriptions.filter(
        (entry) => entry.endpoint !== parsed.data.endpoint,
      );

      deduped.unshift({
        ...parsed.data,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        userAgent: String(req.get("User-Agent") || "") || null,
      });

      const capped = deduped.slice(0, 5);
      const nextSettings = putSubscriptions(user.accountSettings || {}, capped);
      await storage.updateUser(user.id, { accountSettings: nextSettings as any });

      return res.json({ success: true, count: capped.length });
    },
  );

  app.post(
    "/api/notifications/push/unsubscribe",
    isAuthenticated,
    async (req: any, res) => {
      const endpoint = String(req.body?.endpoint || "").trim();
      if (!endpoint) {
        return res.status(400).json({ message: "Endpoint is required" });
      }

      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentSubscriptions = getSubscriptions(user.accountSettings || {});
      const filtered = currentSubscriptions.filter((entry) => entry.endpoint !== endpoint);
      const nextSettings = putSubscriptions(user.accountSettings || {}, filtered);
      await storage.updateUser(user.id, { accountSettings: nextSettings as any });

      return res.json({ success: true, count: filtered.length });
    },
  );

  app.post("/api/notifications/push/test", isAuthenticated, async (req: any, res) => {
    const user = await storage.getUser(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const subscriptions = getSubscriptions(user.accountSettings || {});
    if (!subscriptions.length) {
      return res.status(400).json({ message: "No push subscriptions registered" });
    }

    const payload = {
      title: "MealScout Test",
      body: "Push notifications are connected successfully.",
      url: "/profile/notifications",
      timestamp: Date.now(),
    };

    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        const result = await sendPushNotification(sub, payload);
        return { endpoint: sub.endpoint, ...result };
      }),
    );

    const survivors = subscriptions.filter((sub) => {
      const row = results.find((r) => r.endpoint === sub.endpoint);
      return row?.ok || (row?.statusCode !== 404 && row?.statusCode !== 410);
    });

    if (survivors.length !== subscriptions.length) {
      const nextSettings = putSubscriptions(user.accountSettings || {}, survivors);
      await storage.updateUser(user.id, { accountSettings: nextSettings as any });
    }

    return res.json({
      success: results.some((r) => r.ok),
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  });

  app.get("/api/admin/push/status", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    return res.json(getPushConfigSummary());
  });
}
