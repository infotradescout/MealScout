import { and, eq, inArray } from "drizzle-orm";
import { restaurants, supplierOrders, supplierOrderItems, supplierProducts, supplierRequests, supplierRequestItems, suppliers } from "@shared/schema";
import type { ComputeOnPlatformPaymentFees, HaversineMiles } from "../routes/suppliers/shared";

export class SupplierOrderError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const fail = (message: string, status = 409): never => { throw new SupplierOrderError(message, status); };
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;

export function validateSupplierOrderFees(supplierGrossCents: number, fees: ReturnType<ComputeOnPlatformPaymentFees> | null) {
  if (!validMoney(supplierGrossCents)) fail("Order total is invalid or too large.", 400);
    if (fees && !validMoney(fees.totalCents)) fail("Order total is invalid or too large.", 400);
    if (fees) {
      const applicationFee = fees.platformFeeCents + fees.buyerProcessingFeeCents;
      const transfer = supplierGrossCents - fees.sellerProcessingFeeCents;
      if (![fees.platformFeeCents, fees.stripeFeeEstimateCents, fees.buyerProcessingFeeCents,
        fees.sellerProcessingFeeCents, applicationFee, transfer].every(validMoney) ||
        applicationFee > fees.totalCents || transfer > fees.totalCents ||
        applicationFee + transfer > fees.totalCents) {
        fail("This order total cannot support online payment fees. Use offsite payment or adjust the order.", 400);
      }
    }
}

/** Lock the request before reading prices or creating its one authoritative order. */
export async function acceptSupplierRequest(database: any, input: {
  requestId: string; supplierId: string; userId: string;
  computeFees: ComputeOnPlatformPaymentFees; haversineMiles: HaversineMiles;
}) {
  return database.transaction(async (tx: any) => {
    const [request] = await tx.select().from(supplierRequests).where(and(
      eq(supplierRequests.id, input.requestId), eq(supplierRequests.supplierId, input.supplierId),
    )).for("update");
    if (!request) fail("Request not found", 404);
    if (request.status !== "submitted" || request.orderId) fail("Request is not pending.");
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).for("share");
    if (!supplier?.isActive) fail("Supplier is not available.");
    const items = await tx.select().from(supplierRequestItems)
      .where(eq(supplierRequestItems.requestId, request.id)).for("share");
    if (!items.length || items.some((item: any) => !item.productId)) {
      fail("Request contains unmapped items. Update the request before accepting.", 400);
    }
    const productIds = [...new Set<string>(items.map((item: any) => String(item.productId)))];
    const products = await tx.select().from(supplierProducts).where(and(
      eq(supplierProducts.supplierId, supplier.id), inArray(supplierProducts.id, productIds),
    )).for("share");
    const byId = new Map<string, any>(products.map((product: any) => [product.id, product]));
    const isDelivery = request.requestedFulfillment === "delivery";
    const normalizedItems = items.map((item: any) => {
      const product = byId.get(item.productId);
      if (!product?.isActive) fail("A requested product is no longer available.", 400);
      if (isDelivery && !product.deliveryEligible) fail("A requested product cannot be delivered.", 400);
      const unitPriceCents = Number(product.priceCents);
      const quantity = Number(item.quantity);
      const lineTotalCents = unitPriceCents * quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !validMoney(unitPriceCents) || !validMoney(lineTotalCents)) {
        fail("Request has an invalid quantity or price.", 400);
      }
      return { productId: product.id, quantity, unitPriceCents, lineTotalCents };
    });
    const subtotalCents = normalizedItems.reduce((sum: number, item: any) => sum + item.lineTotalCents, 0);
    const deliveryFeeCents = isDelivery ? Number(request.deliveryFeeCents ?? supplier.deliveryFeeCents) : 0;
    const supplierGrossCents = subtotalCents + deliveryFeeCents;
    if (!validMoney(subtotalCents) || !validMoney(deliveryFeeCents) || !validMoney(supplierGrossCents)) {
      fail("Order total is invalid or too large.", 400);
    }
    if (isDelivery) {
      if (!supplier.offersDelivery) fail("Supplier no longer offers delivery.");
      if (subtotalCents < supplier.deliveryMinOrderCents) fail("Order does not meet the delivery minimum.", 400);
      if (supplier.deliveryRadiusMiles > 0) {
        const [buyer] = request.buyerRestaurantId ? await tx.select({ latitude: restaurants.latitude, longitude: restaurants.longitude })
          .from(restaurants).where(eq(restaurants.id, request.buyerRestaurantId)) : [];
        const coordinates = [supplier.latitude, supplier.longitude, buyer?.latitude, buyer?.longitude];
        if (coordinates.some((value) => value == null || !Number.isFinite(Number(value)))) {
          fail("Verify the delivery address before accepting an order with a delivery radius.", 400);
        }
        if (input.haversineMiles(
          { lat: Number(supplier.latitude), lon: Number(supplier.longitude) },
          { lat: Number(buyer.latitude), lon: Number(buyer.longitude) },
        ) > supplier.deliveryRadiusMiles) fail("Delivery address is outside the supplier's delivery radius.", 400);
      }
    }
    const isOnline = request.paymentPreference === "online";
    if (isOnline && !supplier.onlinePaymentsEnabled) fail("Supplier no longer accepts online payments.");
    if (isOnline && subtotalCents < supplier.onlinePaymentsMinOrderCents) fail("Order does not meet the online payment minimum.", 400);
    const fees = isOnline ? input.computeFees(supplierGrossCents) : null;
    validateSupplierOrderFees(supplierGrossCents, fees);
    const now = new Date();
    const [order] = await tx.insert(supplierOrders).values({
      supplierId: supplier.id, buyerUserId: request.buyerUserId, truckRestaurantId: request.buyerRestaurantId,
      status: "submitted", paymentMethod: isOnline ? "stripe" : "offsite", paymentStatus: isOnline ? "unpaid" : "offsite",
      requestedFulfillment: isDelivery ? "delivery" : "pickup", subtotalCents, deliveryFeeCents,
      platformFeeCents: fees?.platformFeeCents ?? 0, stripeFeeEstimateCents: fees?.stripeFeeEstimateCents ?? 0,
      totalCents: fees?.totalCents ?? supplierGrossCents, stripeChargeAmountCents: fees?.totalCents ?? 0,
      stripeApplicationFeeCents: fees ? fees.platformFeeCents + fees.buyerProcessingFeeCents : 0,
      stripeTransferAmountCents: fees ? supplierGrossCents - fees.sellerProcessingFeeCents : 0,
      buyerDiscountCents: 0, buyerPaymentMethod: null, pickupNote: request.note, createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(supplierOrderItems).values(normalizedItems.map((item: any) => ({
      ...item, orderId: order.id, createdAt: now, updatedAt: now,
    })));
    await tx.update(supplierRequests).set({ status: "accepted", acceptedAt: now, acceptedBy: input.userId,
      orderId: order.id, deliveryStatus: isDelivery ? "accepted" : "pending", updatedAt: now,
    }).where(eq(supplierRequests.id, request.id));
    return { request, order };
  });
}

export async function transitionSupplierOrder(database: any, input: {
  orderId: string; supplierId: string; status: "submitted" | "ready" | "completed" | "cancelled";
}) {
  return database.transaction(async (tx: any) => {
    // Delivery decisions use request -> order lock order on every entry point.
    const [request] = await tx.select().from(supplierRequests).where(and(
      eq(supplierRequests.orderId, input.orderId), eq(supplierRequests.supplierId, input.supplierId),
    )).for("update");
    const [order] = await tx.select().from(supplierOrders).where(and(
      eq(supplierOrders.id, input.orderId), eq(supplierOrders.supplierId, input.supplierId),
    )).for("update");
    if (!order) fail("Order not found", 404);
    if (order.status === input.status) return order;
    const transitions: Record<string, string[]> = { submitted: ["ready", "cancelled"], ready: ["completed", "cancelled"] };
    if (!transitions[order.status]?.includes(input.status)) fail("This order cannot move to that status.");
    const externalPayment = order.paymentMethod === "offsite" && order.paymentStatus === "offsite";
    const paid = order.paymentStatus === "paid";
    if (["ready", "completed"].includes(input.status) && !externalPayment && !paid) {
      fail("Online payment must be confirmed before fulfilling this order.");
    }
    if (input.status === "cancelled" && !externalPayment && (paid || order.stripePaymentIntentId)) {
      fail("Cancel or refund the online payment before cancelling this order.");
    }
    if (request?.requestedFulfillment === "delivery") {
      const nextDelivery = input.status === "ready" ? "out_for_delivery" : input.status === "completed" ? "delivered" : "cancelled";
      const transitions: Record<string,string[]> = { pending:["cancelled"], accepted:["out_for_delivery","cancelled"], out_for_delivery:["delivered","cancelled"] };
      if (request.deliveryStatus !== nextDelivery && !transitions[request.deliveryStatus]?.includes(nextDelivery)) {
        fail("The linked delivery cannot move to that status.");
      }
      await tx.update(supplierRequests).set({ deliveryStatus:nextDelivery,
        ...(nextDelivery === "cancelled" ? {status:"cancelled"} : {}), updatedAt:new Date(),
      }).where(eq(supplierRequests.id,request.id));
    }
    const [updated] = await tx.update(supplierOrders).set({ status: input.status, updatedAt: new Date() })
      .where(eq(supplierOrders.id, order.id)).returning();
    return updated;
  });
}

export async function updateSupplierDelivery(database: any, input: {
  requestId: string; supplierId: string;
  deliveryStatus?: "pending" | "accepted" | "out_for_delivery" | "delivered" | "cancelled";
  deliveryFeeCents?: number; deliveryScheduledFor?: string | null;
}) {
  return database.transaction(async (tx: any) => {
    const [request] = await tx.select().from(supplierRequests).where(and(
      eq(supplierRequests.id, input.requestId), eq(supplierRequests.supplierId, input.supplierId),
    )).for("update");
    if (!request) fail("Request not found", 404);
    if (request.requestedFulfillment !== "delivery") fail("This request is not a delivery request.", 400);
    const currentStatus = request.deliveryStatus;
    const nextStatus = input.deliveryStatus ?? currentStatus;
    const terminal = ["delivered", "cancelled"].includes(currentStatus);
    if (terminal && (nextStatus !== currentStatus || input.deliveryFeeCents !== undefined || input.deliveryScheduledFor !== undefined)) {
      fail("Completed or cancelled deliveries cannot be changed.");
    }
    if (input.deliveryFeeCents !== undefined && (request.status !== "submitted" || request.orderId)) {
      fail("Delivery fees are fixed when the request is accepted.");
    }
    const transitions: Record<string,string[]> = { pending: ["cancelled"], accepted: ["out_for_delivery", "cancelled"], out_for_delivery: ["delivered", "cancelled"] };
    if (nextStatus !== currentStatus && !transitions[currentStatus]?.includes(nextStatus)) fail("This delivery cannot move to that status.");
    let scheduled: Date | null | undefined;
    if (input.deliveryScheduledFor !== undefined) {
      scheduled = input.deliveryScheduledFor === null ? null : new Date(input.deliveryScheduledFor);
      if (scheduled && !Number.isFinite(scheduled.getTime())) fail("Delivery schedule is invalid.", 400);
    }
    if (nextStatus !== currentStatus && request.orderId) {
      const [order] = await tx.select().from(supplierOrders).where(and(
        eq(supplierOrders.id, request.orderId), eq(supplierOrders.supplierId, input.supplierId),
      )).for("update");
      if (!order) fail("Linked order is unavailable.");
      const externalPayment = order.paymentMethod === "offsite" && order.paymentStatus === "offsite";
      if (["out_for_delivery", "delivered"].includes(nextStatus)) {
        if (request.status !== "accepted" || ["cancelled", "completed"].includes(order.status)) fail("Order is not available for delivery.");
        if (!externalPayment && order.paymentStatus !== "paid") fail("Online payment must be confirmed before delivery.");
      }
      if (nextStatus === "cancelled" && (order.status === "completed" ||
        (!externalPayment && (order.paymentStatus === "paid" || order.stripePaymentIntentId)))) {
        fail("Cancel or refund the online payment before cancelling delivery.");
      }
      await tx.update(supplierOrders).set({
        status: nextStatus === "delivered" ? "completed" : nextStatus === "out_for_delivery" ? "ready" : "cancelled", updatedAt: new Date(),
      }).where(eq(supplierOrders.id, order.id));
    } else if (nextStatus !== currentStatus && nextStatus !== "cancelled") {
      fail("Accept the request before starting delivery.");
    }
    const [updated] = await tx.update(supplierRequests).set({
      deliveryStatus: nextStatus,
      ...(nextStatus === "cancelled" ? {status:"cancelled"} : {}),
      ...(input.deliveryFeeCents !== undefined ? {deliveryFeeCents:input.deliveryFeeCents} : {}),
      ...(scheduled !== undefined ? {deliveryScheduledFor:scheduled} : {}), updatedAt:new Date(),
    }).where(eq(supplierRequests.id, request.id)).returning();
    return {request, updated, currentStatus, nextStatus};
  });
}
