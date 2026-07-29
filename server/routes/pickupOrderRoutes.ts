/**
 * pickupOrderRoutes.ts
 * Online ordering for pickup and dine-in.
 *
 * Payment model:
 *   - MealScout collects the full order amount (subtotal + customer fees) via
 *     MealScout's own Stripe account.
 *   - After payment confirms (Stripe webhook), MealScout transfers subtotal to
 *     the business's Stripe Connect account.
 *   - By default customers pay Stripe processing plus the $1 MealScout fee.
 *   - If the business toggles `hidePlatformFee`, the fee is presented as $0 to
 *     the customer (absorbed by the business). The combined fee transfer
 *     reduction is reflected internally.
 *   - Cash orders skip Stripe entirely; MealScout earns nothing (no platform fee
 *     is collected – the fee is simply omitted).
 *
 * WebSocket kitchen queue:
 *   - When order status changes a `kitchen:order_update` event is emitted to the
 *     room `kitchen:{restaurantId}`.
 *   - The kitchen display page subscribes to this room on connect.
 */

import type { Express } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";
import { db, pool } from "../db";
import {
  menus,
  menuItems,
  menuItemVariants,
  menuItemModifiers,
  pickupOrders,
  pickupOrderItems,
  orderNotifications,
  restaurants,
  restaurantSubscriptions,
  telemetryEvents,
  ORDER_STATUS,
  LISA_CLAIM_TYPES,
  LISA_CLAIM_SOURCES,
  lisaClaims,
  type PickupOrder,
  type PickupOrderItem,
  type MenuItem,
  type MenuItemVariant,
  type MenuItemModifier,
} from "@shared/schema";
import {
  isPremiumTrialActive,
  ensurePremiumTrialForUser,
} from "../services/premiumTrial";
import { eq, and, desc, gte, inArray, sql } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { isAdminUserType } from "../roleAccess";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { sendSms } from "../smsService";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { requireIdempotencyKey } from "../middleware/idempotency";
import { getWebSocketServer } from "../websocket";
import {
  consumePromotionAttribution,
  updatePromotedOrderCommissionStatus,
} from "../services/merchantPromotionService";
import {
  cancelCashPickupOrderByOwner,
  cancelPendingPickupOrderForCanceledPaymentIntent,
} from "../services/pickupOrderPaymentCancellation";
import {
  classifyPreOrderPaymentIntentStatus,
  paymentIntentMatchesPickupOrder,
} from "../services/pickupOrderPaymentIntentState";
import { getDeliveryQuote } from "./merchantDeliveryRoutes";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const PICKUP_ORDER_MEALSCOUT_FEE_CENTS = Math.max(
  0,
  Number(process.env.PICKUP_ORDER_MEALSCOUT_FEE_CENTS || 100) || 100,
);
const PICKUP_ORDER_STRIPE_FEE_BPS = Math.max(
  0,
  Number(process.env.PICKUP_ORDER_STRIPE_FEE_BPS || 290) || 290,
);
const PICKUP_ORDER_STRIPE_FEE_FIXED_CENTS = Math.max(
  0,
  Number(process.env.PICKUP_ORDER_STRIPE_FEE_FIXED_CENTS || 30) || 30,
);

class InventoryReservationError extends Error {}

function deterministicPickupOrderId(input: {
  restaurantId: string;
  identity: string;
  idempotencyKey: string;
}) {
  const bytes = createHash("sha256")
    .update(
      `${input.restaurantId}|${input.identity}|${input.idempotencyKey}`,
      "utf8",
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

async function acquireDeliveryCapacityLock(restaurantId: string) {
  const client = await pool.connect();
  const lockKey = `mealscout:merchant-delivery:${restaurantId}`;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
    } finally {
      client.release();
    }
  };
}

function estimateStripeFeeCents(chargeAmountCents: number): number {
  if (!Number.isFinite(chargeAmountCents) || chargeAmountCents <= 0) return 0;
  return Math.max(
    0,
    Math.ceil(
      (chargeAmountCents * PICKUP_ORDER_STRIPE_FEE_BPS) / 10_000 +
        PICKUP_ORDER_STRIPE_FEE_FIXED_CENTS,
    ),
  );
}

function grossUpStripeProcessingFeeCents(
  baseBeforeProcessingCents: number,
): number {
  if (
    !Number.isFinite(baseBeforeProcessingCents) ||
    baseBeforeProcessingCents <= 0
  ) {
    return 0;
  }
  const denominator = 10_000 - PICKUP_ORDER_STRIPE_FEE_BPS;
  if (denominator <= 0) {
    return estimateStripeFeeCents(baseBeforeProcessingCents);
  }
  const grossChargeCents = Math.ceil(
    ((baseBeforeProcessingCents + PICKUP_ORDER_STRIPE_FEE_FIXED_CENTS) *
      10_000) /
      denominator,
  );
  return Math.max(0, grossChargeCents - baseBeforeProcessingCents);
}

function computePickupOrderFees(
  subtotalCents: number,
  paymentMethod: "card" | "cash",
  feePaidByBusiness: boolean,
) {
  const cleanSubtotal = Math.max(0, Math.round(Number(subtotalCents || 0)));
  const mealscoutFeeCents = PICKUP_ORDER_MEALSCOUT_FEE_CENTS;
  const processingFeeCents =
    paymentMethod === "card"
      ? feePaidByBusiness
        ? estimateStripeFeeCents(cleanSubtotal)
        : grossUpStripeProcessingFeeCents(cleanSubtotal + mealscoutFeeCents)
      : 0;
  const platformFeeCents = mealscoutFeeCents + processingFeeCents;
  const totalCents = feePaidByBusiness
    ? cleanSubtotal
    : cleanSubtotal + platformFeeCents;

  return {
    mealscoutFeeCents,
    processingFeeCents,
    platformFeeCents,
    totalCents,
  };
}

// ── Rate limiting ──────────────────────────────────────────────────────────────
const createOrderLimiter = distributedRateLimit({
  scope: "pickup_orders_create",
  limit: 20,
  windowMs: 60 * 1000,
  key: (req) => String((req as any)?.user?.id || req.ip || "unknown"),
});

// ── Error wrapper ─────────────────────────────────────────────────────────────
function wrap(handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      const status = err?.statusCode || 500;
      const message = err?.message || "Internal server error";
      if (status === 500) console.error("[pickupOrderRoutes]", err);
      res.status(status).json({ message });
    }
  };
}

// ── Ownership helper ──────────────────────────────────────────────────────────
async function assertOwnsRestaurant(userId: string, restaurantId: string) {
  const ok = await storage.verifyRestaurantOwnership(restaurantId, userId);
  if (!ok)
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
}

async function assertCanManageRestaurantOrders(
  user: any,
  restaurantId: string,
) {
  if (isAdminUserType(user?.userType)) return;
  if (
    !["restaurant_owner", "food_truck"].includes(String(user?.userType || ""))
  ) {
    throw Object.assign(new Error("Restaurant owner access required"), {
      statusCode: 403,
    });
  }
  await assertOwnsRestaurant(user.id, restaurantId);
}

async function assertOrderingWorkspaceAccess(user: any, restaurantId: string) {
  await assertCanManageRestaurantOrders(user, restaurantId);
  if (!isAdminUserType(user?.userType)) {
    await assertHasOrderingSubscription(user.id, restaurantId);
  }
}

// ── Subscription gate ─────────────────────────────────────────────────────────
/**
 * Throws 403 if the user (restaurant owner) does not have an active ordering
 * subscription. Access hierarchy: trial → lifetime → active monthly subscription.
 */
async function assertHasOrderingSubscription(
  userId: string,
  restaurantId?: string,
) {
  const user = await storage.getUser(userId);
  if (!user)
    throw Object.assign(new Error("User not found"), { statusCode: 401 });

  // 1. Trial access
  const hydratedUser = await ensurePremiumTrialForUser(user);
  if (isPremiumTrialActive(hydratedUser)) return;

  // 2. Lifetime or active subscription via restaurantSubscriptions table
  const restaurants_ = await storage.getRestaurantsByOwner(userId);
  const restaurantIds = restaurantId
    ? restaurants_.filter((r) => r.id === restaurantId).map((r) => r.id)
    : restaurants_.map((r) => r.id);
  if (restaurantIds.length > 0) {
    const [sub] = await db
      .select({
        id: restaurantSubscriptions.id,
        isLifetimeFree: restaurantSubscriptions.isLifetimeFree,
      })
      .from(restaurantSubscriptions)
      .where(
        and(
          inArray(restaurantSubscriptions.restaurantId, restaurantIds),
          eq(restaurantSubscriptions.status, "active"),
        ),
      )
      .limit(1);
    if (sub) return; // covers both lifetime (isLifetimeFree=true) and active paid subscriptions
  }

  // 3. Stripe subscription check as final fallback
  if (stripe && hydratedUser?.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        hydratedUser.stripeSubscriptionId,
      );
      if (stripeSub?.status === "active") return;
    } catch {
      // fall through to denial
    }
  }

  try {
    await db.insert(telemetryEvents).values({
      eventName: "ordering_subscription_denied",
      userId,
      properties: {
        restaurantId: restaurantId ?? null,
        userType: user.userType ?? null,
        reason: "subscription_inactive",
      },
    });
  } catch (telemetryError) {
    console.warn(
      "[pickupOrderRoutes] Failed to record telemetry event",
      telemetryError,
    );
  }

  throw Object.assign(
    new Error(
      "Online ordering requires an active MealScout subscription ($25/mo). Visit your account settings to subscribe.",
    ),
    { statusCode: 403 },
  );
}

// ── Calculate line total ──────────────────────────────────────────────────────
function calcLineTotal(
  basePriceCents: number,
  variantAddCents: number,
  modifierAddCents: number,
  qty: number,
): number {
  return (basePriceCents + variantAddCents + modifierAddCents) * qty;
}

// ── Notification helper ───────────────────────────────────────────────────────
async function sendOrderReadyNotification(order: PickupOrder) {
  const promises: Promise<any>[] = [];

  if (order.customerEmail) {
    promises.push(
      emailService
        .sendBasicEmail(
          order.customerEmail,
          "Your order is ready! 🍽️",
          `
            <p>Hi ${order.customerName},</p>
            <p>Your MealScout order <strong>#${order.id.slice(-6).toUpperCase()}</strong> is ${order.orderType === "delivery" ? "ready and will head out for delivery soon" : "ready for pickup"}!</p>
          `,
          `Hi ${order.customerName}, your order #${order.id.slice(-6).toUpperCase()} is ${order.orderType === "delivery" ? "ready and will head out for delivery soon" : "ready for pickup"}!`,
          "general",
        )
        .then((ok) =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "email",
            type: "ready",
            recipient: order.customerEmail!,
            status: ok ? "sent" : "failed",
            errorMessage: ok ? undefined : "Email provider skipped or failed",
          }),
        )
        .catch((err: any) =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "email",
            type: "ready",
            recipient: order.customerEmail!,
            status: "failed",
            errorMessage: String(err?.message || err),
          }),
        ),
    );
  }

  if (order.customerPhone) {
    promises.push(
      sendSms(
        order.customerPhone,
        `Hi ${order.customerName}! Your MealScout order #${order.id.slice(-6).toUpperCase()} is ${order.orderType === "delivery" ? "ready and will head out soon" : "ready for pickup"}.`,
      )
        .then((ok) =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "sms",
            type: "ready",
            recipient: order.customerPhone!,
            status: ok ? "sent" : "failed",
            errorMessage: ok ? undefined : "SMS provider skipped or failed",
          }),
        )
        .catch((err: any) =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "sms",
            type: "ready",
            recipient: order.customerPhone!,
            status: "failed",
            errorMessage: String(err?.message || err),
          }),
        ),
    );
  }

  await Promise.allSettled(promises);

  await db
    .update(pickupOrders)
    .set({ readyNotificationSent: true, updatedAt: new Date() })
    .where(eq(pickupOrders.id, order.id));
}

// ── WebSocket emitter helper ──────────────────────────────────────────────────
function emitKitchenUpdate(restaurantId: string, order: any) {
  const io = getWebSocketServer();
  if (io) {
    io.to(`kitchen:${restaurantId}`).emit("kitchen:order_update", { order });
  }
}

export function registerPickupOrderRoutes(app: Express) {
  // ── ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER: Create order + payment intent
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/pickup-orders
   * Body:
   * {
   *   restaurantId, menuId,
   *   customerName, customerEmail?, customerPhone?,
   *   orderType: 'pickup' | 'dine_in',
   *   paymentMethod: 'card' | 'cash',
   *   items: [{ menuItemId, quantity, selectedVariantId?, selectedModifierIds?: string[], specialInstructions? }],
   *   specialInstructions?,
   *   scheduledFor?   // ISO string for pre-orders; omit for ASAP
   * }
   *
   * Response:
   *   { order, clientSecret }  — clientSecret is null for cash orders
   */
  app.post(
    "/api/pickup-orders",
    createOrderLimiter,
    requireIdempotencyKey({
      scope: "pickup-order-create",
      ttlMs: 24 * 60 * 60 * 1000,
      lockMs: 2 * 60 * 1000,
    }),
    wrap(async (req, res) => {
      const bodySchema = z.object({
        restaurantId: z.string().min(1),
        menuId: z.string().min(1),
        customerName: z.string().min(1).max(100),
        customerEmail: z.string().email().optional().nullable(),
        customerPhone: z.string().optional().nullable(),
        orderType: z.enum(["pickup", "dine_in", "delivery"]).default("pickup"),
        deliveryAddress: z
          .string()
          .trim()
          .min(5)
          .max(400)
          .optional()
          .nullable(),
        deliveryCity: z.string().trim().min(2).max(100).optional().nullable(),
        deliveryState: z.string().trim().min(2).max(50).optional().nullable(),
        deliveryPostalCode: z
          .string()
          .trim()
          .min(3)
          .max(12)
          .optional()
          .nullable(),
        deliveryInstructions: z.string().trim().max(500).optional().nullable(),
        paymentMethod: z.enum(["card", "cash"]).default("card"),
        items: z
          .array(
            z.object({
              menuItemId: z.string().min(1),
              quantity: z.number().int().min(1).max(50),
              selectedVariantId: z.string().optional().nullable(),
              selectedModifierIds: z.array(z.string()).optional().default([]),
              specialInstructions: z.string().max(200).optional().nullable(),
            }),
          )
          .min(1)
          .max(50),
        specialInstructions: z.string().max(500).optional().nullable(),
        scheduledFor: z.string().datetime().optional().nullable(),
        promotionToken: z.string().max(200).optional().nullable(),
      });

      const body = bodySchema.parse(req.body);
      if (body.orderType === "delivery" && body.scheduledFor) {
        return res.status(400).json({
          message:
            "Scheduled merchant delivery is not available yet. Place an ASAP delivery order instead.",
          code: "scheduled_delivery_unsupported",
        });
      }
      const idempotencyKey = String(
        req.headers["idempotency-key"] || "",
      ).trim();
      const identity =
        String(req.user?.id || "").trim() || String(req.ip || "unknown").trim();
      const orderId = deterministicPickupOrderId({
        restaurantId: body.restaurantId,
        identity,
        idempotencyKey,
      });
      const providerKeyDigest = createHash("sha256")
        .update(
          `${identity}|${idempotencyKey}|${orderId}|${body.restaurantId}`,
          "utf8",
        )
        .digest("hex");

      // If a process stopped after the order transaction committed but before
      // the durable idempotency response was stored, the same request can
      // recover the deterministic order instead of attempting a second insert.
      const [existingOrder] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, orderId))
        .limit(1);
      if (existingOrder) {
        if (
          existingOrder.restaurantId !== body.restaurantId ||
          existingOrder.orderType !== body.orderType ||
          existingOrder.paymentMethod !== body.paymentMethod ||
          existingOrder.customerName !== body.customerName
        ) {
          return res.status(409).json({
            message:
              "The existing order does not match this idempotent request.",
            code: "idempotent_order_mismatch",
          });
        }
        if (existingOrder.status === ORDER_STATUS.CANCELLED) {
          return res.status(409).json({
            message: "The prior order was cancelled. Start checkout again.",
            code: "payment_setup_cancelled",
          });
        }
        if (existingOrder.paymentMethod === "cash") {
          return res.status(201).json({
            order: existingOrder,
            clientSecret: null,
          });
        }
        if (existingOrder.status !== ORDER_STATUS.PENDING) {
          return res.status(201).json({
            order: existingOrder,
            clientSecret: null,
            paymentState: `order_${existingOrder.status}`,
          });
        }
        if (
          !stripe ||
          !String(existingOrder.stripePaymentIntentId || "").trim()
        ) {
          return res.status(503).json({
            message: "Payment recovery is temporarily unavailable.",
          });
        }
        const recoveredIntent = await stripe.paymentIntents.retrieve(
          String(existingOrder.stripePaymentIntentId),
        );
        if (
          !paymentIntentMatchesPickupOrder(recoveredIntent, {
            orderId: existingOrder.id,
            restaurantId: existingOrder.restaurantId,
            totalCents: existingOrder.totalCents,
            transferGroup: String(
              existingOrder.stripeTransferGroupId ||
                `order_${existingOrder.id}`,
            ),
          })
        ) {
          return res.status(503).json({
            message: "Payment recovery is temporarily unavailable.",
            code: "payment_intent_order_mismatch",
          });
        }
        const recoveredDisposition = classifyPreOrderPaymentIntentStatus(
          recoveredIntent.status,
        );
        if (recoveredDisposition === "cancelled") {
          await cancelPendingPickupOrderForCanceledPaymentIntent({
            paymentIntentId: recoveredIntent.id,
            metadataOrderId: existingOrder.id,
            cancellationReason: "Payment setup cancelled",
          });
          return res.status(409).json({
            message: "The prior payment setup was cancelled. Start again.",
            code: "payment_setup_cancelled",
          });
        }
        if (recoveredDisposition === "payment_submitted") {
          return res.status(201).json({
            order: existingOrder,
            clientSecret: null,
            paymentState: recoveredIntent.status,
          });
        }
        if (
          recoveredDisposition === "resume_payment" &&
          recoveredIntent.client_secret
        ) {
          return res.status(201).json({
            order: existingOrder,
            clientSecret: recoveredIntent.client_secret,
            paymentState: recoveredIntent.status,
          });
        }
        if (
          recoveredDisposition !== "create_order" ||
          !recoveredIntent.client_secret
        ) {
          return res.status(503).json({
            message: "Payment recovery is temporarily unavailable.",
            code: "payment_state_reconciliation_required",
          });
        }
        return res.status(201).json({
          order: existingOrder,
          clientSecret: recoveredIntent.client_secret,
        });
      }

      // Fetch menu to check acceptsCash + hidePlatformFee
      const [menu] = await db
        .select()
        .from(menus)
        .where(
          and(
            eq(menus.id, body.menuId),
            eq(menus.restaurantId, body.restaurantId),
          ),
        );
      if (!menu || !menu.isActive) {
        return res.status(400).json({ message: "Menu not available" });
      }

      if (body.paymentMethod === "cash" && !menu.acceptsCash) {
        return res.status(400).json({
          message: "This restaurant does not accept cash orders online",
        });
      }

      // Resolve all menu items
      const itemIds = body.items.map((i) => i.menuItemId);
      const dbItems: MenuItem[] = await db
        .select()
        .from(menuItems)
        .where(
          and(inArray(menuItems.id, itemIds), eq(menuItems.isAvailable, true)),
        );

      const itemMap = new Map<string, MenuItem>(dbItems.map((i) => [i.id, i]));
      const requestedQuantityByItem = new Map<string, number>();
      for (const requestItem of body.items) {
        requestedQuantityByItem.set(
          requestItem.menuItemId,
          (requestedQuantityByItem.get(requestItem.menuItemId) || 0) +
            requestItem.quantity,
        );
      }

      // Check every requested item exists and is available
      for (const reqItem of body.items) {
        const item = itemMap.get(reqItem.menuItemId);
        if (!item) {
          return res.status(400).json({
            message: `Item ${reqItem.menuItemId} is not available`,
          });
        }
        if (item.priceCents === null) {
          return res.status(400).json({
            message: `"${item.name}" cannot be ordered until the business adds a price`,
          });
        }
      }

      // Check inventory for tracked items
      for (const [menuItemId, requestedQuantity] of requestedQuantityByItem) {
        const dbItem = itemMap.get(menuItemId)!;
        if (dbItem.trackInventory && dbItem.inventoryQty !== null) {
          if (dbItem.inventoryQty < requestedQuantity) {
            return res.status(400).json({
              message: `"${dbItem.name}" only has ${dbItem.inventoryQty} left in stock`,
            });
          }
        }
      }

      // Fetch all variants + modifiers for requested items
      const [allVariants, allModifiers]: [
        MenuItemVariant[],
        MenuItemModifier[],
      ] = await Promise.all([
        db
          .select()
          .from(menuItemVariants)
          .where(inArray(menuItemVariants.menuItemId, itemIds)),
        db
          .select()
          .from(menuItemModifiers)
          .where(inArray(menuItemModifiers.menuItemId, itemIds)),
      ]);

      const variantMap = new Map<string, MenuItemVariant>(
        allVariants.map((v) => [v.id, v]),
      );
      const modifierMap = new Map<string, MenuItemModifier>(
        allModifiers.map((m) => [m.id, m]),
      );

      // Build order line items with pricing
      let subtotalCents = 0;
      const lineItems: Array<{
        menuItemId: string;
        itemName: string;
        itemDescription: string | null;
        basePriceCents: number;
        selectedVariant: any;
        selectedModifiers: any[];
        quantity: number;
        lineTotalCents: number;
        specialInstructions: string | null;
      }> = [];

      for (const reqItem of body.items) {
        const item = itemMap.get(reqItem.menuItemId)!;
        if (item.priceCents === null) {
          throw new Error("Unpriced menu item passed checkout validation");
        }
        let variantAddCents = 0;
        let selectedVariant: any = null;

        if (reqItem.selectedVariantId) {
          const variant = variantMap.get(reqItem.selectedVariantId);
          if (variant && variant.menuItemId === item.id) {
            variantAddCents = variant.additionalCents;
            selectedVariant = {
              id: variant.id,
              label: variant.label,
              additionalCents: variant.additionalCents,
            };
          }
        }

        let modifierAddCents = 0;
        const selectedModifiers: any[] = [];
        for (const modId of reqItem.selectedModifierIds ?? []) {
          const mod = modifierMap.get(modId);
          if (mod && mod.menuItemId === item.id) {
            modifierAddCents += mod.additionalCents;
            selectedModifiers.push({
              id: mod.id,
              groupName: mod.groupName,
              label: mod.label,
              additionalCents: mod.additionalCents,
            });
          }
        }

        const lineTotalCents = calcLineTotal(
          item.priceCents,
          variantAddCents,
          modifierAddCents,
          reqItem.quantity,
        );

        subtotalCents += lineTotalCents;

        lineItems.push({
          menuItemId: item.id,
          itemName: item.name,
          itemDescription: item.description ?? null,
          basePriceCents: item.priceCents,
          selectedVariant,
          selectedModifiers,
          quantity: reqItem.quantity,
          lineTotalCents,
          specialInstructions: reqItem.specialInstructions ?? null,
        });
      }

      const feePaidByBusiness = menu.hidePlatformFee;
      const {
        mealscoutFeeCents,
        processingFeeCents,
        platformFeeCents,
        totalCents: baseTotalCents,
      } = computePickupOrderFees(
        subtotalCents,
        body.paymentMethod,
        feePaidByBusiness,
      );

      // Determine prep time from menu's restaurant
      const [restaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, body.restaurantId));
      if (!restaurant || !restaurant.isActive) {
        return res.status(400).json({ message: "Restaurant not available" });
      }

      const scheduledFor = body.scheduledFor
        ? new Date(body.scheduledFor)
        : null;
      const releaseDeliveryCapacityLock =
        body.orderType === "delivery"
          ? await acquireDeliveryCapacityLock(body.restaurantId)
          : null;
      try {
        let deliveryFeeCents = 0;
        let deliveryEstimateMinutes: number | null = null;
        if (body.orderType === "delivery") {
          if (
            !body.deliveryAddress ||
            !body.deliveryCity ||
            !body.deliveryState ||
            !body.deliveryPostalCode
          ) {
            return res.status(400).json({
              message:
                "Delivery address, city, state, and postal code are required",
            });
          }
          const delivery = await getDeliveryQuote(
            body.restaurantId,
            subtotalCents,
            body.deliveryPostalCode,
            scheduledFor,
          );
          deliveryFeeCents = delivery.feeCents;
          deliveryEstimateMinutes = delivery.estimatedMinutes;
        }
        const totalCents = baseTotalCents + deliveryFeeCents;

        // Verify this restaurant has an active ordering subscription.
        if (restaurant.ownerId) {
          await assertHasOrderingSubscription(
            restaurant.ownerId,
            restaurant.id,
          );
        }

        const transferGroup = `order_${orderId}`;

        // Card setup happens before any order, attribution, or inventory write.
        // A provider failure therefore cannot strand local side effects.
        let paymentIntent: Stripe.PaymentIntent | null = null;
        if (body.paymentMethod === "card") {
          if (!stripe) {
            return res
              .status(503)
              .json({ message: "Payment processing is not configured" });
          }
          try {
            paymentIntent = await stripe.paymentIntents.create(
              {
                amount: totalCents,
                currency: "usd",
                automatic_payment_methods: { enabled: true },
                transfer_group: transferGroup,
                metadata: {
                  pickupOrderId: orderId,
                  orderId,
                  restaurantId: body.restaurantId,
                  subtotalCents: subtotalCents.toString(),
                  platformFeeCents: platformFeeCents.toString(),
                  mealscoutFeeCents: mealscoutFeeCents.toString(),
                  processingFeeCents: processingFeeCents.toString(),
                  deliveryFeeCents: deliveryFeeCents.toString(),
                  feePaidByBusiness: String(feePaidByBusiness),
                },
                description: `MealScout order at ${restaurant.name}`,
              },
              {
                idempotencyKey: `pickup-order:${providerKeyDigest}`,
              },
            );
          } catch (stripeErr: any) {
            console.error(
              "[pickupOrderRoutes] Stripe PI creation failed:",
              stripeErr,
            );
            return res
              .status(502)
              .json({ message: "Payment setup failed. Please try again." });
          }
          try {
            // Stripe idempotency can replay the original create response even
            // after that PaymentIntent was later cancelled. Retrieve current
            // provider state before any local order or inventory write.
            paymentIntent = await stripe.paymentIntents.retrieve(
              paymentIntent.id,
            );
          } catch (stripeErr: any) {
            console.error(
              "[pickupOrderRoutes] Stripe PI reconciliation failed:",
              stripeErr,
            );
            return res.status(502).json({
              message: "Payment setup could not be verified. Please try again.",
              code: "payment_state_reconciliation_required",
            });
          }
          if (
            !paymentIntentMatchesPickupOrder(paymentIntent, {
              orderId,
              restaurantId: body.restaurantId,
              totalCents,
              transferGroup,
            })
          ) {
            return res.status(503).json({
              message:
                "Payment setup did not match this order. Please try again.",
              code: "payment_intent_order_mismatch",
            });
          }
          const intentDisposition = classifyPreOrderPaymentIntentStatus(
            paymentIntent.status,
          );
          if (intentDisposition === "cancelled") {
            return res.status(409).json({
              message:
                "The prior payment setup was cancelled. Start checkout again.",
              code: "payment_setup_cancelled",
            });
          }
          if (
            intentDisposition !== "create_order" ||
            !paymentIntent.client_secret
          ) {
            return res.status(503).json({
              message:
                "Payment state could not be reconciled safely. Please try again.",
              code: "payment_state_reconciliation_required",
            });
          }
        }

        let order: PickupOrder;
        try {
          order = await db.transaction(async (tx: any) => {
            const now = new Date();
            const [insertedOrder] = await tx
              .insert(pickupOrders)
              .values({
                id: orderId,
                restaurantId: body.restaurantId,
                customerId: req.user?.id ?? null,
                customerName: body.customerName,
                customerEmail: body.customerEmail ?? null,
                customerPhone: body.customerPhone ?? null,
                orderType: body.orderType,
                status:
                  body.paymentMethod === "cash"
                    ? ORDER_STATUS.CONFIRMED
                    : ORDER_STATUS.PENDING,
                subtotalCents,
                platformFeeCents,
                feePaidByBusiness,
                totalCents,
                paymentMethod: body.paymentMethod,
                specialInstructions: body.specialInstructions ?? null,
                prepTimeMinutes: 20,
                scheduledFor,
                deliveryAddress:
                  body.orderType === "delivery" ? body.deliveryAddress : null,
                deliveryCity:
                  body.orderType === "delivery" ? body.deliveryCity : null,
                deliveryState:
                  body.orderType === "delivery" ? body.deliveryState : null,
                deliveryPostalCode:
                  body.orderType === "delivery"
                    ? body.deliveryPostalCode
                    : null,
                deliveryFeeCents,
                deliveryEstimateMinutes,
                deliveryInstructions:
                  body.orderType === "delivery"
                    ? body.deliveryInstructions
                    : null,
                stripePaymentIntentId: paymentIntent?.id ?? null,
                stripeTransferGroupId:
                  body.paymentMethod === "card" ? transferGroup : null,
                confirmedAt: body.paymentMethod === "cash" ? now : null,
                updatedAt: now,
              })
              .returning();

            if (body.promotionToken) {
              await consumePromotionAttribution(
                {
                  token: body.promotionToken,
                  orderId: insertedOrder.id,
                  targetRestaurantId: body.restaurantId,
                  customerUserId: req.user?.id ?? null,
                  eligibleOrderCents: subtotalCents,
                  commissionEligible: body.paymentMethod === "card",
                },
                tx,
              );
            }

            await tx.insert(pickupOrderItems).values(
              lineItems.map((lineItem) => ({
                ...lineItem,
                orderId: insertedOrder.id,
              })),
            );

            for (const [
              menuItemId,
              requestedQuantity,
            ] of requestedQuantityByItem) {
              const databaseItem = itemMap.get(menuItemId)!;
              if (
                databaseItem.trackInventory &&
                databaseItem.inventoryQty !== null
              ) {
                const [reservedItem] = await tx
                  .update(menuItems)
                  .set({
                    inventoryQty: sql`${menuItems.inventoryQty} - ${requestedQuantity}`,
                    isAvailable: sql`${menuItems.inventoryQty} - ${requestedQuantity} > 0`,
                    inventoryAutoUnavailable: sql`${menuItems.inventoryQty} - ${requestedQuantity} = 0`,
                    updatedAt: now,
                  })
                  .where(
                    and(
                      eq(menuItems.id, databaseItem.id),
                      eq(menuItems.restaurantId, body.restaurantId),
                      eq(menuItems.trackInventory, true),
                      eq(menuItems.isAvailable, true),
                      gte(menuItems.inventoryQty, requestedQuantity),
                    ),
                  )
                  .returning({ id: menuItems.id });
                if (!reservedItem) {
                  throw new InventoryReservationError(
                    `"${databaseItem.name}" inventory changed during checkout`,
                  );
                }
              }
            }
            return insertedOrder as PickupOrder;
          });
        } catch (persistenceError) {
          if (persistenceError instanceof InventoryReservationError) {
            let paymentRollbackSucceeded = true;
            if (paymentIntent && stripe) {
              try {
                await stripe.paymentIntents.cancel(
                  paymentIntent.id,
                  {},
                  {
                    idempotencyKey: `pickup-order:${providerKeyDigest}:rollback`,
                  },
                );
              } catch (cancelError) {
                paymentRollbackSucceeded = false;
                console.error(
                  `[pickupOrderRoutes] Failed to cancel orphaned PaymentIntent ${paymentIntent.id}:`,
                  cancelError,
                );
              }
            }
            if (paymentRollbackSucceeded) {
              return res.status(409).json({
                message:
                  "An item changed or sold out during checkout. Review the cart and try again.",
                code: "inventory_reservation_conflict",
              });
            }
          }
          // A transient database failure returns a retryable response without
          // cancelling the PaymentIntent. The same request key can then reuse
          // Stripe's idempotent create result and retry the local transaction.
          throw persistenceError;
        }

        if (body.paymentMethod === "cash") {
          emitKitchenUpdate(body.restaurantId, order);
          if (body.customerEmail) {
            emailService
              .sendBasicEmail(
                body.customerEmail,
                `Order confirmed – ${restaurant.name}`,
                `<p>Hi ${body.customerName}, your order has been received! Total: $${(totalCents / 100).toFixed(2)} (pay at restaurant)</p>`,
                `Hi ${body.customerName}, your order has been received! Total: $${(totalCents / 100).toFixed(2)} (pay at restaurant)`,
                "general",
              )
              .catch(() => {});
          }
          db.insert(lisaClaims)
            .values({
              app: "mealscout",
              claimType: LISA_CLAIM_TYPES.ORDER_PLACED,
              source: LISA_CLAIM_SOURCES.ORDER,
              subjectType: "order",
              subjectId: order.id,
              actorType: req.user?.id ? "user" : "guest",
              actorId: req.user?.id ?? "guest",
              payload: {
                restaurantId: body.restaurantId,
                orderType: body.orderType,
                totalCents,
                paymentMethod: "cash",
              },
            })
            .catch(() => {});
          return res.status(201).json({ order, clientSecret: null });
        }

        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_PLACED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: order.id,
            actorType: req.user?.id ? "user" : "guest",
            actorId: req.user?.id ?? "guest",
            payload: {
              restaurantId: body.restaurantId,
              orderType: body.orderType,
              totalCents,
              paymentMethod: "card",
            },
          })
          .catch(() => {});
        return res.status(201).json({
          order,
          clientSecret: paymentIntent?.client_secret,
        });
      } finally {
        await releaseDeliveryCapacityLock?.();
      }
    }),
  );

  app.post(
    "/api/pickup-orders/:orderId/cancel-payment",
    createOrderLimiter,
    requireIdempotencyKey({
      scope: "pickup-order-cancel-payment",
      ttlMs: 24 * 60 * 60 * 1000,
      lockMs: 2 * 60 * 1000,
    }),
    wrap(async (req, res) => {
      const orderId = String(req.params.orderId || "").trim();
      const idempotencyKey = String(
        req.headers["idempotency-key"] || "",
      ).trim();
      const identity =
        String(req.user?.id || "").trim() || String(req.ip || "unknown").trim();
      const [order] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, orderId))
        .limit(1);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      const expectedOrderId = deterministicPickupOrderId({
        restaurantId: order.restaurantId,
        identity,
        idempotencyKey,
      });
      if (expectedOrderId !== order.id) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (order.status === ORDER_STATUS.CANCELLED) {
        return res.json({ order });
      }
      if (
        order.status !== ORDER_STATUS.PENDING ||
        order.paymentMethod !== "card" ||
        !String(order.stripePaymentIntentId || "").trim()
      ) {
        return res.status(409).json({
          message: "This order payment can no longer be cancelled.",
        });
      }
      if (!stripe) {
        return res.status(503).json({
          message: "Payment cancellation is temporarily unavailable.",
        });
      }

      const cancellationDigest = createHash("sha256")
        .update(`${identity}|${idempotencyKey}|${order.id}`, "utf8")
        .digest("hex");
      await stripe.paymentIntents.cancel(
        String(order.stripePaymentIntentId),
        {},
        {
          idempotencyKey: `pickup-order-cancel:${cancellationDigest}`,
        },
      );
      const cancelled = await cancelPendingPickupOrderForCanceledPaymentIntent({
        paymentIntentId: String(order.stripePaymentIntentId),
        metadataOrderId: order.id,
      });
      const [updatedOrder] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, order.id))
        .limit(1);
      if (!cancelled && updatedOrder?.status !== ORDER_STATUS.CANCELLED) {
        return res.status(409).json({
          message: "The order changed before cancellation completed.",
        });
      }
      return res.json({ order: updatedOrder ?? order });
    }),
  );

  // ── ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER: Poll order status
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/pickup-orders/:orderId
   * Returns order + items. No auth required (customers link to this page).
   * We don't expose sensitive financial details to unauthenticated requests.
   */
  app.get(
    "/api/pickup-orders/:orderId",
    wrap(async (req, res) => {
      const { orderId } = req.params;
      const [order] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, orderId));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const items = await db
        .select()
        .from(pickupOrderItems)
        .where(eq(pickupOrderItems.orderId, orderId));

      // Strip payment intent details for non-owners
      const userId = (req as any)?.user?.id;
      const isOwner =
        userId &&
        (order.customerId === userId ||
          (await storage.verifyRestaurantOwnership(
            order.restaurantId,
            userId,
          )));

      const safeOrder = isOwner
        ? order
        : {
            ...order,
            stripePaymentIntentId: undefined,
            stripeTransferGroupId: undefined,
          };

      res.json({ order: safeOrder, items });
    }),
  );

  /**
   * GET /api/pickup-orders/by-intent/:paymentIntentId
   * Poll an order by Stripe PaymentIntent ID (used after Stripe redirect).
   */
  app.get(
    "/api/pickup-orders/by-intent/:paymentIntentId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { paymentIntentId } = req.params;
      const [order] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.stripePaymentIntentId, paymentIntentId));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const items = await db
        .select()
        .from(pickupOrderItems)
        .where(eq(pickupOrderItems.orderId, order.id));

      res.json({ order, items });
    }),
  );

  // ── ─────────────────────────────────────────────────────────────────────────
  // OWNER: Kitchen queue + status management
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/owner/kitchen-queue/:restaurantId
   * Returns active orders (pending / confirmed / preparing / ready) sorted newest first.
   */
  app.get(
    "/api/owner/kitchen-queue/:restaurantId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOrderingWorkspaceAccess(req.user, restaurantId);

      const activeOrders: PickupOrder[] = await db
        .select()
        .from(pickupOrders)
        .where(
          and(
            eq(pickupOrders.restaurantId, restaurantId),
            inArray(pickupOrders.status, [
              ORDER_STATUS.PENDING,
              ORDER_STATUS.CONFIRMED,
              ORDER_STATUS.PREPARING,
              ORDER_STATUS.READY,
              ORDER_STATUS.OUT_FOR_DELIVERY,
            ]),
          ),
        )
        .orderBy(desc(pickupOrders.createdAt));

      const orderIds = activeOrders.map((o) => o.id);
      const items: PickupOrderItem[] =
        orderIds.length > 0
          ? await db
              .select()
              .from(pickupOrderItems)
              .where(inArray(pickupOrderItems.orderId, orderIds))
          : [];

      const ordersWithItems = activeOrders.map((order) => ({
        ...order,
        items: items.filter((i) => i.orderId === order.id),
      }));

      res.json({ orders: ordersWithItems });
    }),
  );

  /**
   * GET /api/owner/orders/:restaurantId
   * Full order history (all statuses, paginated).
   */
  app.get(
    "/api/owner/orders/:restaurantId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOrderingWorkspaceAccess(req.user, restaurantId);

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = 50;
      const offset = (page - 1) * limit;

      const orders: PickupOrder[] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.restaurantId, restaurantId))
        .orderBy(desc(pickupOrders.createdAt))
        .limit(limit)
        .offset(offset);

      const orderIds = orders.map((order) => order.id);
      const items: PickupOrderItem[] =
        orderIds.length > 0
          ? await db
              .select()
              .from(pickupOrderItems)
              .where(inArray(pickupOrderItems.orderId, orderIds))
          : [];

      res.json({
        orders: orders.map((order) => ({
          ...order,
          items: items.filter((item) => item.orderId === order.id),
        })),
        page,
        hasMore: orders.length === limit,
      });
    }),
  );

  /**
   * PATCH /api/owner/orders/:orderId/status
   * Advance order through the kitchen lifecycle.
   * Allowed transitions:
   *   pending    → confirmed | cancelled
   *   confirmed  → preparing | cancelled
   *   preparing  → ready     | cancelled
   *   ready      → completed | out_for_delivery
   *   out_for_delivery → delivered
   *   delivered  → completed
   */
  app.patch(
    "/api/owner/orders/:orderId/status",
    isAuthenticated,
    wrap(async (req, res) => {
      const { orderId } = req.params;
      const { status, prepTimeMinutes, cancellationReason } = z
        .object({
          status: z.enum([
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.PREPARING,
            ORDER_STATUS.READY,
            ORDER_STATUS.OUT_FOR_DELIVERY,
            ORDER_STATUS.DELIVERED,
            ORDER_STATUS.COMPLETED,
            ORDER_STATUS.CANCELLED,
          ]),
          prepTimeMinutes: z.number().int().min(1).max(120).optional(),
          cancellationReason: z.string().max(500).optional(),
        })
        .parse(req.body);

      const [order] = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.id, orderId));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await assertOrderingWorkspaceAccess(req.user, order.restaurantId);

      // Validate transition
      const validTransitions: Record<string, string[]> = {
        [ORDER_STATUS.PENDING]: [
          ORDER_STATUS.CONFIRMED,
          ORDER_STATUS.CANCELLED,
        ],
        [ORDER_STATUS.CONFIRMED]: [
          ORDER_STATUS.PREPARING,
          ORDER_STATUS.CANCELLED,
        ],
        [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY, ORDER_STATUS.CANCELLED],
        [ORDER_STATUS.READY]:
          order.orderType === "delivery"
            ? [ORDER_STATUS.OUT_FOR_DELIVERY]
            : [ORDER_STATUS.COMPLETED],
        [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
        [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.COMPLETED],
      };
      const allowed = validTransitions[order.status] ?? [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          message: `Cannot transition from ${order.status} to ${status}`,
        });
      }

      if (
        status === ORDER_STATUS.CONFIRMED &&
        order.status === ORDER_STATUS.PENDING &&
        order.paymentMethod === "card"
      ) {
        return res.status(409).json({
          message:
            "Card orders are confirmed only after Stripe reports a successful payment.",
        });
      }

      if (
        status === ORDER_STATUS.CANCELLED &&
        order.status === ORDER_STATUS.PENDING &&
        order.paymentMethod === "card"
      ) {
        if (!stripe || !String(order.stripePaymentIntentId || "").trim()) {
          return res.status(503).json({
            message:
              "The pending card payment cannot be cancelled safely right now.",
          });
        }
        await stripe.paymentIntents.cancel(
          String(order.stripePaymentIntentId),
          {},
          {
            idempotencyKey: `pickup-order-owner-cancel:${order.id}`,
          },
        );
        const cancelled =
          await cancelPendingPickupOrderForCanceledPaymentIntent({
            paymentIntentId: String(order.stripePaymentIntentId),
            metadataOrderId: order.id,
            cancellationReason: cancellationReason || "Cancelled by restaurant",
          });
        const [updated] = await db
          .select()
          .from(pickupOrders)
          .where(eq(pickupOrders.id, order.id))
          .limit(1);
        if (!cancelled && updated?.status !== ORDER_STATUS.CANCELLED) {
          return res.status(409).json({
            message: "The order changed before cancellation completed.",
          });
        }
        emitKitchenUpdate(order.restaurantId, updated ?? order);
        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_CANCELLED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: order.id,
            actorType: "restaurant",
            actorId: order.restaurantId,
            payload: {
              cancellationReason:
                updated?.cancellationReason ||
                cancellationReason ||
                "Cancelled by restaurant",
            },
          })
          .catch(() => {});
        return res.json({ order: updated ?? order });
      }

      if (status === ORDER_STATUS.CANCELLED && order.paymentMethod === "card") {
        return res.status(409).json({
          message:
            "A confirmed card order requires a separately authorized refund flow before cancellation.",
        });
      }

      if (
        status === ORDER_STATUS.CANCELLED &&
        order.status === ORDER_STATUS.PREPARING
      ) {
        return res.status(409).json({
          message:
            "An order already being prepared cannot be returned to inventory through this action.",
        });
      }

      if (
        status === ORDER_STATUS.CANCELLED &&
        order.status === ORDER_STATUS.CONFIRMED &&
        order.paymentMethod === "cash"
      ) {
        const updated = await cancelCashPickupOrderByOwner({
          orderId: order.id,
          cancellationReason,
        });
        if (!updated) {
          return res.status(409).json({
            message: "The order changed before cancellation completed.",
          });
        }
        emitKitchenUpdate(order.restaurantId, updated);
        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_CANCELLED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: updated.id,
            actorType: "restaurant",
            actorId: updated.restaurantId,
            payload: { cancellationReason: updated.cancellationReason },
          })
          .catch(() => {});
        return res.json({ order: updated });
      }

      const now = new Date();
      const updates: Partial<PickupOrder & { updatedAt: Date }> = {
        status,
        updatedAt: now,
      };

      if (status === ORDER_STATUS.CONFIRMED) {
        updates.confirmedAt = now;
        if (prepTimeMinutes) updates.prepTimeMinutes = prepTimeMinutes;
      }
      if (status === ORDER_STATUS.READY) updates.readyAt = now;
      if (status === ORDER_STATUS.OUT_FOR_DELIVERY)
        updates.outForDeliveryAt = now;
      if (status === ORDER_STATUS.DELIVERED) updates.deliveredAt = now;
      if (status === ORDER_STATUS.COMPLETED) updates.completedAt = now;
      if (status === ORDER_STATUS.CANCELLED) {
        updates.cancelledAt = now;
        updates.cancellationReason =
          cancellationReason || "Cancelled by restaurant";
      }

      const [updated] = await db
        .update(pickupOrders)
        .set(updates)
        .where(eq(pickupOrders.id, orderId))
        .returning();

      // Notify customer when order is ready
      if (status === ORDER_STATUS.READY && !order.readyNotificationSent) {
        sendOrderReadyNotification(updated).catch(console.error);
      }

      // Emit to kitchen display WebSocket room
      emitKitchenUpdate(order.restaurantId, updated);

      // Emit LISA claims for terminal status transitions
      if (status === ORDER_STATUS.COMPLETED) {
        await updatePromotedOrderCommissionStatus(order.id, "completed");
        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_COMPLETED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: updated.id,
            actorType: "restaurant",
            actorId: updated.restaurantId,
            payload: {
              totalCents: updated.totalCents,
              orderType: updated.orderType,
            },
          })
          .catch(() => {});
      } else if (status === ORDER_STATUS.CANCELLED) {
        await updatePromotedOrderCommissionStatus(order.id, "cancelled");
        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_CANCELLED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: updated.id,
            actorType: "restaurant",
            actorId: updated.restaurantId,
            payload: { cancellationReason: updated.cancellationReason },
          })
          .catch(() => {});
      }

      res.json({ order: updated });
    }),
  );

  // ── ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER: View own order history
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/my/orders
   * Returns the authenticated customer's order history.
   */
  app.get(
    "/api/my/orders",
    isAuthenticated,
    wrap(async (req, res) => {
      const orders = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.customerId, req.user.id))
        .orderBy(desc(pickupOrders.createdAt))
        .limit(50);

      res.json({ orders });
    }),
  );
}
