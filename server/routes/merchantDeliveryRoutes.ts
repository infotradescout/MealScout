import type { Express } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import { isAdminUserType } from "../roleAccess";
import { storage } from "../storage";
import { merchantDeliverySettings, restaurants } from "@shared/schema";
import { normalizeDeliverySchedule } from "../services/deliveryEligibility";

async function canManage(user: any, restaurantId: string) {
  if (isAdminUserType(user?.userType)) return true;
  return storage.verifyRestaurantOwnership(restaurantId, user?.id);
}

export async function getDeliveryQuote(
  _restaurantId: string,
  _subtotalCents: number,
  _postalCode: string,
  _scheduledFor?: Date | null,
  _executor: any = db,
  _lockSettings = false,
) {
  throw Object.assign(
    new Error(
      "MealScout delivery checkout is not available. Pickup is the only supported fulfillment mode.",
    ),
    { statusCode: 409 },
  );
}

export async function getPublicMerchantDeliveryAvailability(
  restaurantId: string,
) {
  const [restaurant] = await db
    .select({
      id: restaurants.id,
    })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  if (!restaurant) return null;
  return {
    enabled: false,
    configured: false,
    availableNow: false,
    feeCents: 0,
    minimumOrderCents: 0,
    estimatedMinutes: null,
    postalCodes: [],
    deliveryHours: {},
    instructions: null,
    timeZone: null,
    unavailableReason:
      "MealScout delivery checkout is not available. Pickup is the only supported fulfillment mode.",
  };
}

export function registerMerchantDeliveryRoutes(app: Express) {
  app.get("/api/restaurants/:restaurantId/delivery", async (req, res) => {
    const availability = await getPublicMerchantDeliveryAvailability(
      req.params.restaurantId,
    );
    if (!availability)
      return res.status(404).json({ message: "Restaurant not found" });
    res.json(availability);
  });

  app.get(
    "/api/owner/restaurants/:restaurantId/delivery",
    isAuthenticated,
    async (req, res) => {
      if (!(await canManage(req.user, req.params.restaurantId))) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const [settings] = await db
        .select()
        .from(merchantDeliverySettings)
        .where(
          eq(merchantDeliverySettings.restaurantId, req.params.restaurantId),
        );
      res.json({
        ...(settings || {
          restaurantId: req.params.restaurantId,
          feeCents: 0,
          minimumOrderCents: 0,
          estimatedMinutes: 45,
          maxConcurrentOrders: 5,
          postalCodes: [],
          deliveryHours: {},
          instructions: null,
        }),
        enabled: false,
        nativeDeliveryAvailable: false,
        unavailableReason:
          "MealScout delivery checkout is not available. Pickup is the only supported fulfillment mode.",
      });
    },
  );

  app.put(
    "/api/owner/restaurants/:restaurantId/delivery",
    isAuthenticated,
    async (req, res) => {
      const restaurantId = req.params.restaurantId;
      if (!(await canManage(req.user, restaurantId))) {
        return res.status(403).json({ message: "Not authorized" });
      }
      const input = z
        .object({
          enabled: z.boolean(),
          feeCents: z.number().int().min(0).max(100_000),
          minimumOrderCents: z.number().int().min(0).max(1_000_000),
          estimatedMinutes: z.number().int().min(10).max(240),
          maxConcurrentOrders: z.number().int().min(1).max(100),
          postalCodes: z.array(z.string().trim().min(3).max(12)).max(100),
          deliveryHours: z.record(z.string(), z.unknown()).default({}),
          instructions: z.string().trim().max(1000).optional().nullable(),
        })
        .parse(req.body);
      if (input.enabled) {
        return res.status(409).json({
          code: "DELIVERY_ORDERING_UNAVAILABLE",
          message:
            "MealScout delivery checkout is not available. Pickup is the only supported fulfillment mode.",
        });
      }
      let deliveryHours: Record<string, Array<{ start: string; end: string }>>;
      try {
        deliveryHours = normalizeDeliverySchedule(input.deliveryHours);
      } catch (error: any) {
        return res.status(400).json({
          message: String(error?.message || "Delivery hours are invalid"),
        });
      }
      const values = {
        ...input,
        deliveryHours,
        restaurantId,
        postalCodes: [
          ...new Set(input.postalCodes.map((code) => code.toUpperCase())),
        ],
        updatedAt: new Date(),
      };
      const [settings] = await db
        .insert(merchantDeliverySettings)
        .values(values)
        .onConflictDoUpdate({
          target: merchantDeliverySettings.restaurantId,
          set: values,
        })
        .returning();
      res.json({ settings });
    },
  );
}
