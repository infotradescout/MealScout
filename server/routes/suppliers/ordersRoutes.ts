import type { Express } from "express";
import { z } from "zod";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  supplierOrderItems,
  supplierOrders,
  supplierProducts,
  suppliers,
} from "@shared/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { distributedRateLimit } from "../../middleware/distributedRateLimit";
import { requireIdempotencyKey } from "../../middleware/idempotency";
import type { SupplierOrdersRouteDeps } from "./shared";

const createSupplierOrderLimiter = distributedRateLimit({
  scope: "supplier_orders_create",
  limit: 40,
  windowMs: 60 * 1000,
  key: (req) => String((req as any)?.user?.id || req.ip || "unknown"),
});

const supplierOrderIdempotency = requireIdempotencyKey({
  scope: "supplier_orders_create",
  ttlMs: 24 * 60 * 60 * 1000,
});

export function registerSupplierOrdersRoutes(
  app: Express,
  deps: SupplierOrdersRouteDeps,
) {
  const {
    isSupplierProfileOrAdmin,
    ensureSupplierProfile,
    parsePageLimit,
    parseBeforeTimestamp,
    resolveBuyerRestaurantOrThrow,
    computeOnPlatformPaymentFees,
    stripe,
  } = deps;

  // Buyer ordering (business or individual)
  app.post(
    "/api/supplier-orders",
    isAuthenticated,
    supplierOrderIdempotency,
    createSupplierOrderLimiter,
    async (req: any, res) => {
      try {
        const schema = z.object({
          supplierId: z.string().min(1),
          truckRestaurantId: z.string().optional().nullable(),
          paymentMethod: z.enum(["stripe", "offsite"]).default("offsite"),
          pickupNote: z.string().max(2000).optional().nullable(),
          items: z
            .array(
              z.object({
                productId: z.string().min(1),
                quantity: z.number().int().min(1).max(10_000),
              }),
            )
            .min(1),
        });
        const parsed = schema.parse(req.body || {});

        const truckRestaurantId = String(parsed.truckRestaurantId || "").trim();
        if (truckRestaurantId) {
          const biz = await storage.getRestaurant(truckRestaurantId);
          if (!biz || String(biz.ownerId) !== String(req.user.id)) {
            return res.status(403).json({ message: "Not authorized" });
          }
        }

        const [supplier] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, parsed.supplierId), eq(suppliers.isActive, true)))
          .limit(1);
        if (!supplier) return res.status(404).json({ message: "Supplier not found" });

        const productIds = Array.from(new Set(parsed.items.map((i) => i.productId)));
        const products = await db
          .select()
          .from(supplierProducts)
          .where(
            and(
              eq(supplierProducts.supplierId, supplier.id),
              eq(supplierProducts.isActive, true),
              inArray(supplierProducts.id, productIds),
            ),
          );
        const productById = new Map<string, any>(products.map((p: any) => [String(p.id), p]));

        let subtotalCents = 0;
        const normalizedItems = parsed.items.map((item) => {
          const product = productById.get(String(item.productId));
          if (!product) {
            throw new Error(`Invalid product: ${item.productId}`);
          }
          const unitPriceCents = Number(product.priceCents || 0) || 0;
          const lineTotalCents = unitPriceCents * Number(item.quantity || 0);
          subtotalCents += lineTotalCents;
          return {
            productId: String(product.id),
            quantity: Number(item.quantity),
            unitPriceCents,
            lineTotalCents,
          };
        });

        if (subtotalCents <= 0) {
          return res.status(400).json({ message: "Order total must be greater than $0." });
        }

        const supplierGrossCents = subtotalCents;
        const feeModel =
          parsed.paymentMethod === "stripe"
            ? computeOnPlatformPaymentFees(supplierGrossCents)
            : null;
        const platformFeeCents = feeModel ? feeModel.platformFeeCents : 0;
        const stripeFeeEstimateCents = feeModel ? feeModel.stripeFeeEstimateCents : 0;
        const totalCents = feeModel ? feeModel.totalCents : supplierGrossCents;

        const bypassStripe =
          String(process.env.MEALSCOUT_BYPASS_STRIPE || "").toLowerCase() === "true" ||
          String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true";

        if (parsed.paymentMethod === "stripe" && !stripe && !bypassStripe) {
          return res.status(500).json({ message: "Stripe not configured" });
        }
        if (parsed.paymentMethod === "stripe") {
          if (!(supplier as any).onlinePaymentsEnabled) {
            return res.status(400).json({ message: "Supplier does not accept online payments." });
          }
          const destination = String((supplier as any).stripeConnectAccountId || "").trim();
          if (!destination) {
            return res.status(400).json({
              message: "Supplier is not set up to receive online payments yet.",
              code: "supplier_stripe_not_connected",
            });
          }
          if (
            ((supplier as any).stripeChargesEnabled === false ||
              (supplier as any).stripePayoutsEnabled === false) &&
            !bypassStripe
          ) {
            return res.status(400).json({
              message: "Supplier payout account is not fully enabled yet.",
              code: "supplier_stripe_not_ready",
            });
          }
        }

        const now = new Date();

        const created = await db.transaction(async (tx: any) => {
          const [order] = await tx
            .insert(supplierOrders)
            .values({
              supplierId: supplier.id,
              buyerUserId: String(req.user.id),
              truckRestaurantId: truckRestaurantId || null,
              status: "submitted",
              paymentMethod: parsed.paymentMethod,
              paymentStatus: parsed.paymentMethod === "offsite" ? "offsite" : "unpaid",
              subtotalCents,
              platformFeeCents,
              stripeFeeEstimateCents,
              totalCents,
              stripeChargeAmountCents: feeModel ? feeModel.totalCents : 0,
              stripeApplicationFeeCents: feeModel
                ? feeModel.platformFeeCents + feeModel.buyerProcessingFeeCents
                : 0,
              stripeTransferAmountCents: feeModel
                ? supplierGrossCents - feeModel.sellerProcessingFeeCents
                : 0,
              buyerDiscountCents: 0,
              buyerPaymentMethod: null,
              pickupNote: parsed.pickupNote ?? null,
              createdAt: now,
              updatedAt: now,
            } as any)
            .returning();

          const values = normalizedItems.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: item.lineTotalCents,
            createdAt: now,
            updatedAt: now,
          }));
          await tx.insert(supplierOrderItems).values(values as any);
          return order;
        });

        if (parsed.paymentMethod === "offsite") {
          return res.status(201).json({ order: created, payment: { method: "offsite" } });
        }

        if (bypassStripe) {
          await db
            .update(supplierOrders)
            .set({
              paymentStatus: "paid",
              updatedAt: new Date(),
            } as any)
            .where(eq(supplierOrders.id, created.id));
          return res.status(201).json({
            order: { ...created, paymentStatus: "paid" },
            payment: {
              bypassed: true,
              totalCents,
              breakdown: {
                supplierGrossCents,
                buyerProcessingFeeCents: feeModel ? feeModel.buyerProcessingFeeCents : 0,
                sellerProcessingFeeCents: feeModel ? feeModel.sellerProcessingFeeCents : 0,
                platformBaseFeeCents: feeModel ? feeModel.platformBaseFeeCents : 0,
              },
            },
          });
        }

        if (!stripe) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        res.status(201).json({
          order: created,
          payment: {
            method: "stripe",
            requiresPaymentIntent: true,
            totalCents,
            breakdown: {
              supplierGrossCents,
              platformFeeCents,
              stripeFeeEstimateCents,
              buyerProcessingFeeCents: feeModel ? feeModel.buyerProcessingFeeCents : 0,
              sellerProcessingFeeCents: feeModel ? feeModel.sellerProcessingFeeCents : 0,
              platformBaseFeeCents: feeModel ? feeModel.platformBaseFeeCents : 0,
            },
          },
        });
      } catch (error: any) {
        console.error("Error creating supplier order:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid order data", errors: error.errors });
        }
        res.status(400).json({ message: error.message || "Failed to create order" });
      }
    },
  );

  app.get(
    "/api/supplier/orders",
    isAuthenticated,
    isSupplierProfileOrAdmin,
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const limit = parsePageLimit(req.query?.limit, 100, 300);
        const before = parseBeforeTimestamp(req.query?.before);
        const whereClause = before
          ? and(
              eq(supplierOrders.supplierId, supplier.id),
              lt(supplierOrders.createdAt, before),
            )
          : eq(supplierOrders.supplierId, supplier.id);
        const orders = await db
          .select()
          .from(supplierOrders)
          .where(whereClause)
          .orderBy(desc(supplierOrders.createdAt))
          .limit(limit);
        if (orders.length > 0) {
          const tail: any = orders[orders.length - 1];
          const tailCreatedAt = tail?.createdAt ? new Date(tail.createdAt).toISOString() : "";
          if (tailCreatedAt) res.setHeader("X-Next-Before", tailCreatedAt);
        }
        res.json(orders);
      } catch (error) {
        console.error("Error listing supplier orders:", error);
        res.status(500).json({ message: "Failed to load orders" });
      }
    },
  );

  app.get("/api/supplier-orders/mine", isAuthenticated, async (req: any, res) => {
    try {
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const limit = parsePageLimit(req.query?.limit, 100, 300);
      const before = parseBeforeTimestamp(req.query?.before);

      let whereClause: any = eq(supplierOrders.buyerUserId, String(req.user.id));
      if (buyerRestaurantId) {
        const buyerRestaurant = await resolveBuyerRestaurantOrThrow(req, buyerRestaurantId);
        whereClause = eq(supplierOrders.truckRestaurantId, String((buyerRestaurant as any).id));
      }
      if (before) {
        whereClause = and(whereClause, lt(supplierOrders.createdAt, before));
      }

      const rows = await db
        .select({ order: supplierOrders, supplier: suppliers })
        .from(supplierOrders)
        .innerJoin(suppliers, eq(supplierOrders.supplierId, suppliers.id))
        .where(whereClause)
        .orderBy(desc(supplierOrders.createdAt))
        .limit(limit);
      if (rows.length > 0) {
        const tail: any = rows[rows.length - 1];
        const tailCreatedAt = tail?.order?.createdAt
          ? new Date(tail.order.createdAt).toISOString()
          : "";
        if (tailCreatedAt) res.setHeader("X-Next-Before", tailCreatedAt);
      }

      res.json(
        (rows as any[]).map((r: any) => ({
          ...r.order,
          supplier: {
            id: String(r.supplier.id),
            businessName: String(r.supplier.businessName),
            onlinePaymentsEnabled: Boolean(r.supplier.onlinePaymentsEnabled),
            onlinePaymentsAllowAch: Boolean(r.supplier.onlinePaymentsAllowAch ?? true),
            onlinePaymentsAllowCard: Boolean(r.supplier.onlinePaymentsAllowCard ?? true),
          },
        })),
      );
    } catch (error: any) {
      console.error("Error listing buyer supplier orders:", error);
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to load orders" });
    }
  });

  app.get("/api/supplier-orders/:orderId", isAuthenticated, async (req: any, res) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ message: "orderId required" });

      const [order] = await db
        .select()
        .from(supplierOrders)
        .where(eq(supplierOrders.id, orderId))
        .limit(1);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const buyerUserId = String((order as any).buyerUserId || "").trim();
      if (buyerUserId && buyerUserId === String(req.user.id)) {
        return res.json(order);
      }
      const buyerRestaurantId = String((order as any).truckRestaurantId || "").trim();
      const buyerRestaurant = buyerRestaurantId
        ? await storage.getRestaurant(buyerRestaurantId).catch(() => null)
        : null;
      if (!buyerRestaurant || String((buyerRestaurant as any).ownerId) !== String(req.user.id)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      res.json(order);
    } catch (error: any) {
      console.error("Error loading buyer supplier order:", error);
      res.status(500).json({ message: error.message || "Failed to load order" });
    }
  });

  app.patch(
    "/api/supplier/orders/:orderId/status",
    isAuthenticated,
    isSupplierProfileOrAdmin,
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const orderId = String(req.params.orderId || "").trim();
        if (!orderId) return res.status(400).json({ message: "Order ID required" });

        const schema = z.object({
          status: z.enum(["submitted", "ready", "completed", "cancelled"]),
        });
        const parsed = schema.parse(req.body || {});

        const [existing] = await db
          .select()
          .from(supplierOrders)
          .where(and(eq(supplierOrders.id, orderId), eq(supplierOrders.supplierId, supplier.id)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Order not found" });

        const [updated] = await db
          .update(supplierOrders)
          .set({ status: parsed.status, updatedAt: new Date() } as any)
          .where(eq(supplierOrders.id, orderId))
          .returning();
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating supplier order status:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid status", errors: error.errors });
        }
        res.status(500).json({ message: error.message || "Failed to update order" });
      }
    },
  );
}
