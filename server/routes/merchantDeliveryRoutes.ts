import type { Express } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import { isAdminUserType } from "../roleAccess";
import { storage } from "../storage";
import {
  merchantDeliverySettings,
  pickupOrders,
  restaurants,
} from "@shared/schema";
import {
  evaluateDeliveryEligibility,
  isDeliveryScheduleAvailable,
  normalizeDeliverySchedule,
} from "../services/deliveryEligibility";
import { resolveCityTimeZoneStrict } from "../services/cityTimeZone";

async function canManage(user: any, restaurantId: string) {
  if (isAdminUserType(user?.userType)) return true;
  return storage.verifyRestaurantOwnership(restaurantId, user?.id);
}

export async function getDeliveryQuote(
  restaurantId: string,
  subtotalCents: number,
  postalCode: string,
  scheduledFor?: Date | null,
) {
  const [settings] = await db
    .select()
    .from(merchantDeliverySettings)
    .where(eq(merchantDeliverySettings.restaurantId, restaurantId));
  if (!settings)
    throw Object.assign(new Error("Delivery is not available"), {
      statusCode: 400,
    });
  const [restaurant] = await db
    .select({ city: restaurants.city, state: restaurants.state })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  const timeZone = await resolveCityTimeZoneStrict({
    city: restaurant?.city,
    state: restaurant?.state,
  });
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pickupOrders)
    .where(
      and(
        eq(pickupOrders.restaurantId, restaurantId),
        eq(pickupOrders.orderType, "delivery"),
        inArray(pickupOrders.status, [
          "pending",
          "confirmed",
          "preparing",
          "ready",
          "out_for_delivery",
        ]),
      ),
    );
  const eligibility = evaluateDeliveryEligibility({
    enabled: settings.enabled,
    subtotalCents,
    minimumOrderCents: settings.minimumOrderCents,
    postalCode,
    postalCodes: settings.postalCodes,
    activeOrders: Number(count),
    maxConcurrentOrders: settings.maxConcurrentOrders,
    deliveryHours: settings.deliveryHours,
    now: scheduledFor ?? undefined,
    timeZone: timeZone ?? undefined,
  });
  if (!eligibility.ok) {
    throw Object.assign(new Error(eligibility.message), {
      statusCode: eligibility.statusCode,
    });
  }
  return settings;
}

export function registerMerchantDeliveryRoutes(app: Express) {
  app.get("/api/restaurants/:restaurantId/delivery", async (req, res) => {
    const [restaurant] = await db
      .select({
        id: restaurants.id,
        city: restaurants.city,
        state: restaurants.state,
      })
      .from(restaurants)
      .where(eq(restaurants.id, req.params.restaurantId));
    if (!restaurant)
      return res.status(404).json({ message: "Restaurant not found" });
    const [settings] = await db
      .select()
      .from(merchantDeliverySettings)
      .where(eq(merchantDeliverySettings.restaurantId, restaurant.id));
    const timeZone = await resolveCityTimeZoneStrict({
      city: restaurant.city,
      state: restaurant.state,
    });
    const availableNow = Boolean(
      settings?.enabled &&
      isDeliveryScheduleAvailable({
        deliveryHours: settings.deliveryHours,
        timeZone: timeZone ?? undefined,
      }),
    );
    res.json({
      enabled: Boolean(settings?.enabled),
      availableNow,
      feeCents: settings?.feeCents ?? 0,
      minimumOrderCents: settings?.minimumOrderCents ?? 0,
      estimatedMinutes: settings?.estimatedMinutes ?? 45,
      postalCodes: settings?.postalCodes ?? [],
      deliveryHours: settings?.deliveryHours ?? {},
      instructions: settings?.instructions ?? null,
    });
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
      res.json(
        settings || {
          restaurantId: req.params.restaurantId,
          enabled: false,
          feeCents: 0,
          minimumOrderCents: 0,
          estimatedMinutes: 45,
          maxConcurrentOrders: 5,
          postalCodes: [],
          deliveryHours: {},
          instructions: null,
        },
      );
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
