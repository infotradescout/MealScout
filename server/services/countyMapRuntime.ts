import { createHash } from "node:crypto";
import {
  buildCountyMapEvent,
  createCountyMapClient,
} from "../../integrations/infinity-county-map/county-map-client.mjs";

const COUNTY_FIPS_PATTERN = /^\d{5}$/;

export type CompletedPickupOrder = {
  orderId: string;
  restaurantId: string;
  orderType: string;
  status: string;
  completedAt: Date | string | null;
  merchantAcknowledgedAt: Date | string | null;
  countyFips: string | null;
};

export type MealScoutCountyMapRuntimeDependencies = {
  loadCompletedPickupOrder?: (
    orderId: string
  ) => Promise<CompletedPickupOrder | null>;
};

export class MealScoutCountyMapRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "MealScoutCountyMapRuntimeError";
  }
}

function normalizeCountyFips(value: unknown): string {
  const countyFips = String(value || "");
  if (!COUNTY_FIPS_PATTERN.test(countyFips)) {
    throw new MealScoutCountyMapRuntimeError(
      "invalid_county_fips",
      400,
      "countyFips must contain five digits"
    );
  }
  return countyFips;
}

function normalizeRecordId(value: unknown, label: string): string {
  const recordId = String(value || "");
  if (
    recordId.length === 0 ||
    recordId.length > 160 ||
    recordId.trim() !== recordId ||
    /[\u0000-\u001f\u007f]/.test(recordId)
  ) {
    throw new MealScoutCountyMapRuntimeError(
      "invalid_" + label,
      400,
      label + " is invalid"
    );
  }
  return recordId;
}

function completionTimestamp(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) {
    throw new MealScoutCountyMapRuntimeError(
      "pickup_completion_not_proven",
      409,
      "The pickup order has no valid completion timestamp"
    );
  }
  return date.toISOString();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredClient() {
  const baseUrl = String(process.env.COUNTY_MAP_BASE_URL || "");
  const productSecret = String(process.env.COUNTY_MAP_PRODUCT_SECRET || "");
  if (!baseUrl || !productSecret) {
    throw new MealScoutCountyMapRuntimeError(
      "county_map_sync_unavailable",
      503,
      "County-map synchronization is not configured"
    );
  }
  return createCountyMapClient({ baseUrl, productSecret });
}

async function defaultLoadCompletedPickupOrder(
  orderId: string
): Promise<CompletedPickupOrder | null> {
  const [{ db }, schema, drizzle] = await Promise.all([
    import("../db"),
    import("../../shared/schema/legacy"),
    import("drizzle-orm"),
  ]);
  const { pickupOrders, restaurants } = schema;
  const { and, eq, isNotNull } = drizzle;
  const [row] = await db
    .select({
      orderId: pickupOrders.id,
      restaurantId: pickupOrders.restaurantId,
      orderType: pickupOrders.orderType,
      status: pickupOrders.status,
      completedAt: pickupOrders.completedAt,
      merchantAcknowledgedAt: pickupOrders.merchantAcknowledgedAt,
      countyFips: restaurants.countyFips,
    })
    .from(pickupOrders)
    .innerJoin(restaurants, eq(pickupOrders.restaurantId, restaurants.id))
    .where(
      and(
        eq(pickupOrders.id, orderId),
        eq(pickupOrders.orderType, "pickup"),
        eq(pickupOrders.status, "completed"),
        isNotNull(pickupOrders.completedAt)
      )
    )
    .limit(1);
  return row || null;
}

export function createMealScoutCountyMapRuntime(
  dependencies: MealScoutCountyMapRuntimeDependencies = {}
) {
  const loadCompletedPickupOrder =
    dependencies.loadCompletedPickupOrder || defaultLoadCompletedPickupOrder;

  return Object.freeze({
    isConfigured(): boolean {
      const baseUrl = String(process.env.COUNTY_MAP_BASE_URL || "");
      const secret = String(process.env.COUNTY_MAP_PRODUCT_SECRET || "");
      return baseUrl.length > 0 && secret.length >= 16 && secret.length <= 512;
    },

    async readCountyContext(countyFipsInput: string) {
      const countyFips = normalizeCountyFips(countyFipsInput);
      return configuredClient().readCountyRecords({ countyFips, limit: 100 });
    },

    async publishCompletedPickup(
      orderIdInput: string,
      countyFipsInput: string
    ) {
      const orderId = normalizeRecordId(orderIdInput, "pickup_order_id");
      const requestedCountyFips = normalizeCountyFips(countyFipsInput);
      const order = await loadCompletedPickupOrder(orderId);
      if (!order) {
        throw new MealScoutCountyMapRuntimeError(
          "completed_pickup_order_not_found",
          404,
          "No completed pickup order was found"
        );
      }
      if (order.orderType !== "pickup" || order.status !== "completed") {
        throw new MealScoutCountyMapRuntimeError(
          "pickup_completion_not_proven",
          409,
          "The order is not a completed pickup"
        );
      }

      const persistedCountyFips = normalizeCountyFips(order.countyFips);
      if (persistedCountyFips !== requestedCountyFips) {
        throw new MealScoutCountyMapRuntimeError(
          "pickup_county_mismatch",
          409,
          "The requested county does not match the restaurant county"
        );
      }

      const occurredAt = completionTimestamp(order.completedAt);
      const restaurantId = normalizeRecordId(
        order.restaurantId,
        "restaurant_id"
      );
      const evidenceDigest = digest(
        ["mealscout", "pickup-completion", orderId, restaurantId, occurredAt].join(
          "|"
        )
      );
      const opaqueId = evidenceDigest.slice(0, 40);
      const packet = buildCountyMapEvent({
        countyFips: persistedCountyFips,
        eventId: "mealscout.pickup.completed." + opaqueId,
        eventType: "mealscout.pickup.completed",
        sourceRecordId: "mealscout:pickup-completion:" + opaqueId,
        subject: {
          type: "food-order-outcome",
          id: "pickup-outcome:" + opaqueId,
        },
        actor: { type: "system", id: "mealscout-runtime" },
        occurredAt,
        visibility: { level: "source-product" },
        data: {
          state: "completed",
          serviceMode: "pickup",
          countyMatch: "persisted",
          merchantAcknowledgementPresent: Boolean(
            order.merchantAcknowledgedAt
          ),
        },
        evidenceRefs: ["urn:mealscout:pickup-completion:" + opaqueId],
      });
      return configuredClient().writeCountyEvent(packet);
    },
  });
}

export type MealScoutCountyMapRuntime = ReturnType<
  typeof createMealScoutCountyMapRuntime
>;

export const mealScoutCountyMapRuntime = createMealScoutCountyMapRuntime();
