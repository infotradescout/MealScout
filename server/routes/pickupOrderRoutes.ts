/**
 * pickupOrderRoutes.ts
 * Online ordering for pickup and dine-in.
 *
 * Payment model:
 *   - MealScout collects the full order amount (subtotal + $1 platform fee) via
 *     MealScout's own Stripe account.
 *   - After payment confirms (Stripe webhook), MealScout transfers subtotal to
 *     the business's Stripe Connect account.
 *   - MealScout keeps $1 per order.
 *   - If the business toggles `hidePlatformFee`, the fee is presented as $0 to
 *     the customer (absorbed by the business). The $1 transfer reduction is
 *     reflected internally.
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
  restaurantSubscriptions,
  telemetryEvents,
  ORDER_STATUS,
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
import { eq, and, desc, inArray } from "drizzle-orm";
import { isAuthenticated, isRestaurantOwner } from "../unifiedAuth";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { sendSms } from "../smsService";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { getWebSocketServer } from "../websocket";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

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
      .select({ id: restaurantSubscriptions.id, isLifetimeFree: restaurantSubscriptions.isLifetimeFree })
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
            <p>Your MealScout order <strong>#${order.id.slice(-6).toUpperCase()}</strong> is ready for pickup!</p>
            <p>Head over to pick it up. Thanks for ordering with MealScout.</p>
          `,
          `Hi ${order.customerName}, your order #${order.id.slice(-6).toUpperCase()} is ready for pickup!`,
          "general",
        )
        .then(() =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "email",
            type: "ready",
            recipient: order.customerEmail!,
            status: "sent",
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
        `Hi ${order.customerName}! Your MealScout order #${order.id.slice(-6).toUpperCase()} is ready for pickup.`,
      )
        .then(() =>
          db.insert(orderNotifications).values({
            orderId: order.id,
            channel: "sms",
            type: "ready",
            recipient: order.customerPhone!,
            status: "sent",
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
        orderType: z.enum(["pickup", "dine_in"]).default("pickup"),
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
        return res
          .status(400)
          .json({
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
        if (!itemMap.has(reqItem.menuItemId)) {
          return res.status(400).json({
            message: `Item ${reqItem.menuItemId} is not available`,
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
      const platformFeeCents = 100; // $1.00
      // Customer always pays subtotal + $1 UNLESS business absorbs fee
      const totalCents = feePaidByBusiness
        ? subtotalCents
        : subtotalCents + platformFeeCents;

      // Determine prep time from menu's restaurant
      const [restaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, body.restaurantId));
      if (!restaurant || !restaurant.isActive) {
        return res.status(400).json({ message: "Restaurant not available" });
      }

      // Verify this restaurant has an active ordering subscription
      if (restaurant.ownerId) {
        await assertHasOrderingSubscription(restaurant.ownerId, restaurant.id);
      }

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
        })
        .returning();

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

        // Send email confirmation
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
            orderId: order.id,
            restaurantId: body.restaurantId,
            subtotalCents: subtotalCents.toString(),
            platformFeeCents: platformFeeCents.toString(),
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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(req.user.id, restaurantId);
      await assertHasOrderingSubscription(req.user.id, restaurantId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(req.user.id, restaurantId);
      await assertHasOrderingSubscription(req.user.id, restaurantId);

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = 50;
      const offset = (page - 1) * limit;

      const orders = await db
        .select()
        .from(pickupOrders)
        .where(eq(pickupOrders.restaurantId, restaurantId))
        .orderBy(desc(pickupOrders.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ orders });
    }),
  );

  /**
   * PATCH /api/owner/orders/:orderId/status
   * Advance order through the kitchen lifecycle.
   * Allowed transitions:
   *   pending    → confirmed | cancelled
   *   confirmed  → preparing | cancelled
   *   preparing  → ready     | cancelled
   *   ready      → completed
   */
  app.patch(
    "/api/owner/orders/:orderId/status",
    isAuthenticated,
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { orderId } = req.params;
      const { status, prepTimeMinutes } = z
        .object({
          status: z.enum([
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.PREPARING,
            ORDER_STATUS.READY,
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

      await assertOwnsRestaurant(req.user.id, order.restaurantId);
      await assertHasOrderingSubscription(req.user.id, order.restaurantId);

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
        [ORDER_STATUS.READY]: [ORDER_STATUS.COMPLETED],
      };
      const allowed = validTransitions[order.status] ?? [];
      if (!allowed.includes(status)) {
        return res
          .status(400)
          .json({
            message: `Cannot transition from ${order.status} to ${status}`,
          });
      }

      const now = new Date();
      const updates: Partial<PickupOrder & { updatedAt: Date }> = {
        status,
        updatedAt: now,
      };

      if (status === ORDER_STATUS.CONFIRMED && prepTimeMinutes) {
        updates.prepTimeMinutes = prepTimeMinutes;
        updates.confirmedAt = now;
      }
      if (status === ORDER_STATUS.READY) updates.readyAt = now;
      if (status === ORDER_STATUS.COMPLETED) updates.completedAt = now;
      if (status === ORDER_STATUS.CANCELLED) {
        updates.cancelledAt = now;
        updates.cancellationReason =
          (req.body as any).cancellationReason || "Cancelled by restaurant";
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
