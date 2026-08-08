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
import { hasValidMerchantDeliveryConfiguration } from "../services/merchantDeliverySafety";

async function canManage(user: any, restaurantId: string) {
  if (isAdminUserType(user?.userType)) return true;
  return storage.verifyRestaurantOwnership(restaurantId, user?.id);
}

export async function getDeliveryQuote(
  restaurantId: string,
  subtotalCents: number,
  postalCode: string,
  scheduledFor?: Date | null,
  executor: any = db,
  lockSettings = false,
) {
  let settingsQuery = executor
    .select()
    .from(merchantDeliverySettings)
    .where(eq(merchantDeliverySettings.restaurantId, restaurantId));
  if (lockSettings) settingsQuery = settingsQuery.for("update");
  const [settings] = await settingsQuery;
  if (!hasValidMerchantDeliveryConfiguration(settings))
    throw Object.assign(new Error("Delivery is not available"), {
      statusCode: 400,
    });
  const [restaurant] = await executor
    .select({ city: restaurants.city, state: restaurants.state })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  const timeZone = await resolveCityTimeZoneStrict({
    city: restaurant?.city,
    state: restaurant?.state,
  });
  const [{ count }] = await executor
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

export async function getPublicMerchantDeliveryAvailability(
  restaurantId: string,
) {
  const [restaurant] = await db
    .select({
      id: restaurants.id,
      city: restaurants.city,
      state: restaurants.state,
    })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId));
  if (!restaurant) return null;
  const [settings] = await db
    .select()
    .from(merchantDeliverySettings)
    .where(eq(merchantDeliverySettings.restaurantId, restaurant.id));
  const timeZone = await resolveCityTimeZoneStrict({
    city: restaurant.city,
    state: restaurant.state,
  });
  const configured = hasValidMerchantDeliveryConfiguration(settings);
  const availableNow = Boolean(
    configured &&
      isDeliveryScheduleAvailable({
        deliveryHours: settings.deliveryHours,
        timeZone: timeZone ?? undefined,
      }),
  );
  return {
    enabled: configured,
    configured,
    availableNow,
    feeCents: settings?.feeCents ?? 0,
    minimumOrderCents: settings?.minimumOrderCents ?? 0,
    estimatedMinutes: settings?.estimatedMinutes ?? 45,
    postalCodes: settings?.postalCodes ?? [],
    deliveryHours: settings?.deliveryHours ?? {},
    instructions: settings?.instructions ?? null,
    timeZone,
    unavailableReason: !configured
      ? "Merchant delivery is not currently configured"
      : !availableNow
        ? "Merchant delivery is unavailable at this time"
        : null,
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
      if (values.enabled && values.postalCodes.length === 0) {
        return res.status(400).json({
          message: "At least one delivery ZIP code is required before enabling delivery",
        });
      }
      if (values.enabled && Object.keys(deliveryHours).length > 0) {
        const [restaurant] = await db
          .select({ city: restaurants.city, state: restaurants.state })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId));
        const timeZone = await resolveCityTimeZoneStrict({
          city: restaurant?.city,
          state: restaurant?.state,
        });
        if (!timeZone) {
          return res.status(400).json({
            message: "A valid restaurant city and state are required for scheduled delivery hours",
          });
        }
      }
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
