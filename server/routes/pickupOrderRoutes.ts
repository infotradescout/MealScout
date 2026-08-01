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
import { z } from "zod";
import Stripe from "stripe";
import { db } from "../db";
import {
  menus,
  menuItems,
  menuItemVariants,
  menuItemModifiers,
  pickupOrders,
  pickupOrderItems,
  orderNotifications,
  restaurants,
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
import { eq, and, desc, inArray } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { isAdminUserType } from "../roleAccess";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { sendSms } from "../smsService";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { getWebSocketServer } from "../websocket";
import {
  consumePromotionAttribution,
  updatePromotedOrderCommissionStatus,
} from "../services/merchantPromotionService";
import { getDeliveryQuote } from "./merchantDeliveryRoutes";
import { buildPublicTruckOperatingPlan } from "../services/truckOperatingPlan";
import {
  sendPickupOrderCancelledNotification,
  sendPickupOrderConfirmedNotifications,
} from "../services/pickupOrderNotificationService";

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
      for (const reqItem of body.items) {
        const dbItem = itemMap.get(reqItem.menuItemId)!;
        if (dbItem.trackInventory && dbItem.inventoryQty !== null) {
          if (dbItem.inventoryQty < reqItem.quantity) {
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

      if (restaurant.isFoodTruck) {
        const plan = await buildPublicTruckOperatingPlan(body.restaurantId);
        const currentStop = plan.truckSchedule.currentStop;
        if (
          !currentStop ||
          currentStop.status !== "here_now" ||
          !currentStop.addressPublicLabel
        ) {
          return res.status(409).json({
            message:
              "Ordering opens when this truck confirms its current service window and pickup location.",
            code: "TRUCK_CURRENT_STOP_REQUIRED",
          });
        }
      }

      let deliveryFeeCents = 0;
      let deliveryEstimateMinutes: number | null = null;
      if (body.orderType === "delivery") {
        if (
          !body.deliveryAddress ||
          !body.deliveryCity ||
          !body.deliveryState ||
          !body.deliveryPostalCode
        ) {
          return res
            .status(400)
            .json({
              message:
                "Delivery address, city, state, and postal code are required",
            });
        }
        const delivery = await getDeliveryQuote(
          body.restaurantId,
          subtotalCents,
          body.deliveryPostalCode,
        );
        deliveryFeeCents = delivery.feeCents;
        deliveryEstimateMinutes = delivery.estimatedMinutes;
      }
      const totalCents = baseTotalCents + deliveryFeeCents;

      // Insert order
      const [order] = await db
        .insert(pickupOrders)
        .values({
          restaurantId: body.restaurantId,
          customerId: req.user?.id ?? null,
          customerName: body.customerName,
          customerEmail: body.customerEmail ?? null,
          customerPhone: body.customerPhone ?? null,
          orderType: body.orderType,
          status: ORDER_STATUS.PENDING,
          subtotalCents,
          platformFeeCents,
          feePaidByBusiness,
          totalCents,
          paymentMethod: body.paymentMethod,
          specialInstructions: body.specialInstructions ?? null,
          prepTimeMinutes: 20,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
          deliveryAddress:
            body.orderType === "delivery" ? body.deliveryAddress : null,
          deliveryCity:
            body.orderType === "delivery" ? body.deliveryCity : null,
          deliveryState:
            body.orderType === "delivery" ? body.deliveryState : null,
          deliveryPostalCode:
            body.orderType === "delivery" ? body.deliveryPostalCode : null,
          deliveryFeeCents,
          deliveryEstimateMinutes,
          deliveryInstructions:
            body.orderType === "delivery" ? body.deliveryInstructions : null,
        })
        .returning();

      if (body.promotionToken) {
        await consumePromotionAttribution({
          token: body.promotionToken,
          orderId: order.id,
          targetRestaurantId: body.restaurantId,
          customerUserId: req.user?.id ?? null,
          eligibleOrderCents: subtotalCents,
          commissionEligible: body.paymentMethod === "card",
        });
      }

      // Insert line items
      await db
        .insert(pickupOrderItems)
        .values(lineItems.map((li) => ({ ...li, orderId: order.id })));

      // Deduct inventory for tracked items
      for (const reqItem of body.items) {
        const dbItem = itemMap.get(reqItem.menuItemId)!;
        if (dbItem.trackInventory && dbItem.inventoryQty !== null) {
          const newQty = dbItem.inventoryQty - reqItem.quantity;
          await db
            .update(menuItems)
            .set({
              inventoryQty: newQty,
              isAvailable: newQty > 0,
              updatedAt: new Date(),
            })
            .where(eq(menuItems.id, dbItem.id));
        }
      }

      // For cash orders: confirm immediately, no Stripe needed
      if (body.paymentMethod === "cash") {
        const [confirmed] = await db
          .update(pickupOrders)
          .set({
            status: ORDER_STATUS.CONFIRMED,
            confirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pickupOrders.id, order.id))
          .returning();

        emitKitchenUpdate(body.restaurantId, confirmed);

        sendPickupOrderConfirmedNotifications(confirmed).catch(console.error);

        // Emit LISA claim for order placed
        db.insert(lisaClaims)
          .values({
            app: "mealscout",
            claimType: LISA_CLAIM_TYPES.ORDER_PLACED,
            source: LISA_CLAIM_SOURCES.ORDER,
            subjectType: "order",
            subjectId: confirmed.id,
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

        return res.status(201).json({ order: confirmed, clientSecret: null });
      }

      // Card payment: create Stripe PaymentIntent
      if (!stripe) {
        // No Stripe configured – should not happen in production
        await db.delete(pickupOrders).where(eq(pickupOrders.id, order.id));
        return res
          .status(503)
          .json({ message: "Payment processing is not configured" });
      }

      const transferGroup = `order_${order.id}`;

      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: totalCents,
          currency: "usd",
          automatic_payment_methods: { enabled: true },
          transfer_group: transferGroup,
          metadata: {
            pickupOrderId: order.id,
            orderId: order.id,
            restaurantId: body.restaurantId,
            subtotalCents: subtotalCents.toString(),
            platformFeeCents: platformFeeCents.toString(),
            mealscoutFeeCents: mealscoutFeeCents.toString(),
            processingFeeCents: processingFeeCents.toString(),
            deliveryFeeCents: deliveryFeeCents.toString(),
            feePaidByBusiness: String(feePaidByBusiness),
          },
          description: `MealScout order at ${restaurant.name}`,
        });
      } catch (stripeErr: any) {
        // Clean up pending order if Stripe fails
        await db.delete(pickupOrders).where(eq(pickupOrders.id, order.id));
        console.error(
          "[pickupOrderRoutes] Stripe PI creation failed:",
          stripeErr,
        );
        return res
          .status(502)
          .json({ message: "Payment setup failed. Please try again." });
      }

      // Attach intent IDs to order
      const [updatedOrder] = await db
        .update(pickupOrders)
        .set({
          stripePaymentIntentId: paymentIntent.id,
          stripeTransferGroupId: transferGroup,
          updatedAt: new Date(),
        })
        .where(eq(pickupOrders.id, order.id))
        .returning();

      // Emit LISA claim for card order placed (payment pending)
      db.insert(lisaClaims)
        .values({
          app: "mealscout",
          claimType: LISA_CLAIM_TYPES.ORDER_PLACED,
          source: LISA_CLAIM_SOURCES.ORDER,
          subjectType: "order",
          subjectId: updatedOrder.id,
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

      res.status(201).json({
        order: updatedOrder,
        clientSecret: paymentIntent.client_secret,
      });
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
      const { status, prepTimeMinutes } = z
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
        if (order.paymentMethod === "card") {
          if (!stripe || !order.stripePaymentIntentId) {
            return res.status(503).json({
              message:
                "This paid order cannot be cancelled until its payment can be refunded safely.",
            });
          }

          const paymentIntent = await stripe.paymentIntents.retrieve(
            order.stripePaymentIntentId,
          );
          if (paymentIntent.status === "succeeded") {
            const transferGroup = String(
              order.stripeTransferGroupId || "",
            ).trim();
            if (order.payoutStatus === "transferred" && transferGroup) {
              const transfers = await stripe.transfers.list({
                transfer_group: transferGroup,
                limit: 10,
              });
              for (const transfer of transfers.data) {
                const reversibleAmount =
                  transfer.amount - transfer.amount_reversed;
                if (transfer.reversed || reversibleAmount <= 0) continue;
                await stripe.transfers.createReversal(
                  transfer.id,
                  { amount: reversibleAmount },
                  {
                    idempotencyKey: `pickup-order:${order.id}:transfer-reversal`,
                  },
                );
              }
            }

            const refund = await stripe.refunds.create(
              {
                payment_intent: order.stripePaymentIntentId,
                reason: "requested_by_customer",
                metadata: { pickupOrderId: order.id },
              },
              { idempotencyKey: `pickup-order:${order.id}:refund` },
            );
            if (
              !["succeeded", "pending"].includes(String(refund.status || ""))
            ) {
              return res.status(502).json({
                message:
                  "The refund did not complete, so the order was not cancelled.",
              });
            }
            updates.payoutStatus = "reversed";
          } else if (
            !["canceled", "requires_payment_method"].includes(
              paymentIntent.status,
            )
          ) {
            await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
          }
        }
        updates.cancelledAt = now;
        updates.cancellationReason =
          (req.body as any).cancellationReason || "Cancelled by restaurant";
      }

      const [updated] = await db
        .update(pickupOrders)
        .set(updates)
        .where(eq(pickupOrders.id, orderId))
        .returning();

      if (status === ORDER_STATUS.CANCELLED) {
        sendPickupOrderCancelledNotification(updated).catch(console.error);
      }

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
