import { canUseParkingPassTestFeatures as canUseFinancialTestFeatures } from "../../utils/parkingPassTestAccess";
import { createHash } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { db } from "../../db";
import { storage } from "../../storage";
import { supplierOrders, suppliers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { distributedRateLimit } from "../../middleware/distributedRateLimit";
import { requireIdempotencyKey } from "../../middleware/idempotency";
import { decideSupplierIntentHandling } from "../../utils/supplierPaymentIntent";
import type { SupplierPaymentsRouteDeps } from "./shared";

const supplierPayIntentLimiter = distributedRateLimit({
  scope: "supplier_order_pay_intent",
  limit: 20,
  windowMs: 60 * 1000,
  key: (req) => String((req as any)?.user?.id || req.ip || "unknown"),
});

const supplierPayIntentIdempotency = requireIdempotencyKey({
  scope: "supplier_order_pay_intent",
  ttlMs: 24 * 60 * 60 * 1000,
});

export function registerSupplierPaymentRoutes(
  app: Express,
  deps: SupplierPaymentsRouteDeps,
) {
  const {
    computeOnPlatformPaymentFees,
    computeAchCheaperThresholdCents,
    stripe,
  } = deps;

  app.post(
    "/api/supplier-orders/:orderId/pay-intent",
    isAuthenticated,
    supplierPayIntentIdempotency,
    supplierPayIntentLimiter,
    async (req: any, res) => {
      try {
        if (!stripe)
          return res.status(500).json({ message: "Stripe not configured" });

        const orderId = String(req.params.orderId || "").trim();
        if (!orderId)
          return res.status(400).json({ message: "orderId required" });

        const result = await (deps.database ?? db).transaction(async (tx: any) => {
          const reply = (status: number, body: any) => ({ status, body });
          const [order] = await tx
            .select()
            .from(supplierOrders)
            .where(eq(supplierOrders.id, orderId))
            .limit(1).for("update");
          if (!order) return reply(404, { message: "Order not found" });

          const buyerUserId = String((order as any).buyerUserId || "").trim();
          if (buyerUserId) {
            if (buyerUserId !== String(req.user.id)) {
              return reply(403, { message: "Not authorized" });
            }
          } else {
            const buyerRestaurantId = String(
              (order as any).truckRestaurantId || "",
            ).trim();
            const buyerRestaurant = buyerRestaurantId
              ? await storage.getRestaurant(buyerRestaurantId).catch(() => null)
              : null;
            if (
              !buyerRestaurant ||
              String((buyerRestaurant as any).ownerId) !== String(req.user.id)
            ) {
              return reply(403, { message: "Not authorized" });
            }
          }

          if (String((order as any).paymentMethod || "") !== "stripe") {
            return reply(400, { message: "This order is not set up for online payment." });
          }
          if (String((order as any).paymentStatus || "") === "paid") {
            return reply(409, { message: "Order is already paid." });
          }

          if (!["submitted", "ready"].includes(String(order.status))) {
            return reply(409, { message: "This order is no longer available for payment." });
          }

          const supplierId = String((order as any).supplierId || "").trim();
          const [supplier] = await tx
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, supplierId))
            .limit(1);
          if (!supplier)
            return reply(404, { message: "Supplier not found" });
          if (!(supplier as any).onlinePaymentsEnabled) {
            return reply(400, { message: "Supplier does not accept online payments." });
          }
          if (
            (supplier as any).stripeChargesEnabled === false ||
            (supplier as any).stripePayoutsEnabled === false
          ) {
            return reply(400, {
              message: "Supplier payout account is not fully enabled yet.",
              code: "supplier_stripe_not_ready",
            });
          }

          const destination = String(
            (supplier as any).stripeConnectAccountId || "",
          ).trim();
          if (!destination) {
            return reply(400, {
              message: "Supplier is not set up to receive online payments yet.",
              code: "supplier_stripe_not_connected",
            });
          }

          const supplierGrossCents =
            Math.max(0, Number((order as any).subtotalCents || 0) || 0) +
            Math.max(0, Number((order as any).deliveryFeeCents || 0) || 0);
          const amountCents = Math.max(
            0,
            Number(
              (order as any).stripeChargeAmountCents ||
                (order as any).totalCents ||
                0,
            ) || 0,
          );
          if (
            !Number.isFinite(amountCents) ||
            amountCents <= 0 ||
            supplierGrossCents <= 0
          ) {
            return reply(400, { message: "Invalid order total." });
          }

          const feeModel = computeOnPlatformPaymentFees(supplierGrossCents);
          const transferAmountBaseCents = Math.max(
            0,
            Number(
              (order as any).stripeTransferAmountCents ||
                supplierGrossCents - feeModel.sellerProcessingFeeCents ||
                0,
            ) || 0,
          );
          const applicationFeeBaseCents = Math.max(
            0,
            Number(
              (order as any).stripeApplicationFeeCents ||
                feeModel.platformFeeCents + feeModel.buyerProcessingFeeCents ||
                0,
            ) || 0,
          );

          const minOnline = Math.max(
            0,
            Number((supplier as any).onlinePaymentsMinOrderCents || 0) || 0,
          );
          if (minOnline > 0 && supplierGrossCents < minOnline) {
            return reply(400, {
              message: `Online payments require a minimum order of $${(minOnline / 100).toFixed(2)}.`,
            });
          }

          const methodSchema = z.object({
            paymentMethod: z.enum(["ach", "card"]).optional(),
            promoCode: z.string().max(64).optional(),
          });
          const parsed = methodSchema.parse(req.body || {});

          const normalizedPromoCode = String(parsed.promoCode || "")
            .trim()
            .toUpperCase();
          const isTestDollarPromo =
            normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
          if (normalizedPromoCode) {
            if (!isTestDollarPromo) {
              return reply(400, { message: "Invalid promo code" });
            }
            if (!canUseFinancialTestFeatures(req.user, process.env)) {
              return reply(403, { message: "Not authorized" });
            }
          }

          const configuredDefaultThresholdRaw = String(
            process.env.SUPPLIER_ORDER_ACH_DEFAULT_THRESHOLD_CENTS || "",
          ).trim();
          const thresholdDefaultCents =
            configuredDefaultThresholdRaw === ""
              ? computeAchCheaperThresholdCents()
              : Math.max(0, Number(configuredDefaultThresholdRaw) || 0);
          const discountThresholdCents = Math.max(
            0,
            Number(
              process.env.SUPPLIER_ORDER_ACH_DISCOUNT_THRESHOLD_CENTS ||
                thresholdDefaultCents,
            ) || thresholdDefaultCents,
          );
          const configuredDiscountCents = Math.max(
            0,
            Number(process.env.SUPPLIER_ORDER_ACH_DISCOUNT_CENTS || 0) || 0,
          );

          const allowAch = Boolean(
            (supplier as any).onlinePaymentsAllowAch ?? true,
          );
          const allowCard = Boolean(
            (supplier as any).onlinePaymentsAllowCard ?? true,
          );

          const defaultMethod =
            amountCents >= thresholdDefaultCents && allowAch
              ? "ach"
              : allowCard
                ? "card"
                : allowAch
                  ? "ach"
                  : null;
          const paymentMethod = isTestDollarPromo
            ? "card"
            : (parsed.paymentMethod ?? defaultMethod);
          if (!paymentMethod) {
            return reply(400, {
                message: "No payment methods are enabled for this supplier.",
              });
          }
          if (paymentMethod === "ach" && !allowAch) {
            return reply(400, { message: "Supplier does not allow ACH payments." });
          }
          if (paymentMethod === "card" && !allowCard) {
            return reply(400, { message: "Supplier does not allow card payments." });
          }

          const discountCents =
            paymentMethod === "ach" &&
            configuredDiscountCents > 0 &&
            amountCents >= discountThresholdCents
              ? Math.min(configuredDiscountCents, applicationFeeBaseCents)
              : 0;

          let applicationFeeCents = Math.max(
            0,
            applicationFeeBaseCents - discountCents,
          );
          let chargeAmountCents = Math.max(0, amountCents - discountCents);
          let transferAmountCents = Math.max(0, transferAmountBaseCents);

          if (isTestDollarPromo) {
            applicationFeeCents = 0;
            transferAmountCents = 0;
            chargeAmountCents = 100;
          }

          if (![chargeAmountCents, applicationFeeCents, transferAmountCents].every((amount) =>
            Number.isSafeInteger(amount) && amount >= 0 && amount <= 2_147_483_647) ||
            chargeAmountCents < 50 || applicationFeeCents + transferAmountCents > chargeAmountCents) {
            return reply(400, { message: "Order payment amounts are invalid." });
          }

          const existingIntentId = String(
            (order as any).stripePaymentIntentId || "",
          ).trim();
          if (existingIntentId) {
            let intent: Stripe.PaymentIntent | null = null;
            try {
              intent = await stripe.paymentIntents.retrieve(existingIntentId);
            } catch (retrieveError: any) {
              if (String(retrieveError?.code || "") !== "resource_missing") {
                throw retrieveError;
              }
              await tx
                .update(supplierOrders)
                .set({
                  stripePaymentIntentId: null,
                  updatedAt: new Date(),
                } as any)
                .where(eq(supplierOrders.id, String((order as any).id)));
            }
            if (intent) {
            const decision = decideSupplierIntentHandling({
              intent: {
                status: intent?.status,
                amount: (intent as any)?.amount,
                metadataPaymentMethod: (intent as any)?.metadata?.paymentMethod,
                paymentMethodTypes: Array.isArray(
                  (intent as any)?.payment_method_types,
                )
                  ? ((intent as any).payment_method_types as string[])
                  : [],
              },
              paymentMethod,
              chargeAmountCents,
            });

            if (decision === "reuse") {
              return reply(200, {
                paymentIntentId: intent.id,
                clientSecret: (intent as any).client_secret,
                totalCents: amountCents,
                chargeAmountCents,
                buyerDiscountCents: discountCents,
                paymentMethod,
                breakdown: {
                  supplierGrossCents,
                  platformBaseFeeCents: feeModel.platformBaseFeeCents,
                  buyerProcessingFeeCents: feeModel.buyerProcessingFeeCents,
                  sellerProcessingFeeCents: feeModel.sellerProcessingFeeCents,
                },
              });
            }
            if (decision === "cancel_and_recreate") {
              await stripe.paymentIntents.cancel(existingIntentId);
            } else if (decision !== "recreate") {
              return reply(409, {
                message:
                  "Existing payment is processing. Try again after it completes or fails.",
              });
            }
            }
          }

          const intentParams: Stripe.PaymentIntentCreateParams = {
            amount: chargeAmountCents,
            currency: "usd",
            payment_method_types:
              paymentMethod === "ach" ? ["us_bank_account"] : ["card"],
            metadata: {
              supplierOrderId: String((order as any).id),
              supplierId,
              buyerUserId: String((order as any).buyerUserId || ""),
              buyerRestaurantId: String((order as any).truckRestaurantId || ""),
              paymentType: "supplier_order",
              paymentMethod,
              buyerDiscountCents: String(discountCents),
              promoCode: normalizedPromoCode || "",
            },
            ...(isTestDollarPromo
              ? {}
              : {
                  application_fee_amount:
                    applicationFeeCents > 0 ? applicationFeeCents : undefined,
                  transfer_data: {
                    destination,
                    amount: transferAmountCents,
                  },
                }),
          };

          const paymentKey = createHash("sha256").update(JSON.stringify({
            orderId, previousIntentId: existingIntentId || null, params: intentParams,
          })).digest("hex");
          const intent = await stripe.paymentIntents.create(intentParams, {
            idempotencyKey: `supplier-order:${paymentKey}`,
          });

          await tx
            .update(supplierOrders)
            .set({
              stripePaymentIntentId: intent.id,
              stripeChargeAmountCents: chargeAmountCents,
              stripeApplicationFeeCents: applicationFeeCents,
              stripeTransferAmountCents: transferAmountCents,
              buyerDiscountCents: discountCents,
              buyerPaymentMethod: paymentMethod,
              updatedAt: new Date(),
            } as any)
            .where(eq(supplierOrders.id, String((order as any).id)));

          return reply(200, {
            paymentIntentId: intent.id,
            clientSecret: intent.client_secret,
            totalCents: amountCents,
            chargeAmountCents,
            buyerDiscountCents: discountCents,
            paymentMethod,
            promoCode: normalizedPromoCode || undefined,
            testPricing: isTestDollarPromo,
            breakdown: {
              supplierGrossCents,
              platformBaseFeeCents: feeModel.platformBaseFeeCents,
              buyerProcessingFeeCents: feeModel.buyerProcessingFeeCents,
              sellerProcessingFeeCents: feeModel.sellerProcessingFeeCents,
              platformFeeCents: Math.max(
                0,
                Number((order as any).platformFeeCents || 0) || 0,
              ),
              stripeFeeEstimateCents: Math.max(
                0,
                Number((order as any).stripeFeeEstimateCents || 0) || 0,
              ),
            },
          });
        });
        return res.status(result.status).json(result.body);
      } catch (error: any) {
        console.error("Error creating supplier order PaymentIntent:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid payment request", errors: error.errors });
        }
        res
          .status(500)
          .json({
            message: error.message || "Failed to create payment intent",
          });
      }
    },
  );
}
